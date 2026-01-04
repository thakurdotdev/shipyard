package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/config"
	"github.com/thakurdotdev/control-api/internal/services"
)

type AuthHandler struct {
	oauthService *services.OAuthService
	authService  *services.AuthService
	clientURL    string
}

func NewAuthHandler(pool *pgxpool.Pool) *AuthHandler {
	cfg := config.Get()
	return &AuthHandler{
		oauthService: services.NewOAuthService(pool),
		authService:  services.NewAuthService(pool),
		clientURL:    cfg.ClientURL,
	}
}

func (h *AuthHandler) Routes() chi.Router {
	r := chi.NewRouter()

	// better-auth compatible routes (with hyphens)
	r.Post("/sign-in/social", h.SignInGitHub)
	r.Get("/sign-in/social", h.SignInGitHub)  // Support both GET and POST
	r.Get("/callback/github", h.GitHubCallback)
	r.Get("/get-session", h.GetSession)
	r.Post("/sign-out", h.SignOut)

	return r
}

// SignInGitHub initiates GitHub OAuth flow
func (h *AuthHandler) SignInGitHub(w http.ResponseWriter, r *http.Request) {
	var provider, callbackURL string

	// Handle both GET (query params) and POST (JSON body)
	if r.Method == "POST" {
		var body struct {
			Provider    string `json:"provider"`
			CallbackURL string `json:"callbackURL"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			fmt.Printf("[Auth] Failed to decode JSON body: %v\n", err)
		} else {
			provider = body.Provider
			callbackURL = body.CallbackURL
			fmt.Printf("[Auth] Received SignIn request: provider=%s callback=%s\n", provider, callbackURL)
		}
	} else {
		provider = r.URL.Query().Get("provider")
		callbackURL = r.URL.Query().Get("callbackURL")
	}

	if provider != "github" {
		fmt.Printf("[Auth] Invalid provider received: '%s'\n", provider)
		writeError(w, http.StatusBadRequest, "Only github provider supported")
		return
	}

	state := services.GenerateState()

	// Store state and callbackURL in cookie for validation
	http.SetCookie(w, &http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		Path:     "/",
		HttpOnly: true,
		Secure:   false, // Allow http for localhost
		SameSite: http.SameSiteLaxMode,
		MaxAge:   600, // 10 minutes
	})

	if callbackURL != "" {
		http.SetCookie(w, &http.Cookie{
			Name:     "oauth_callback",
			Value:    callbackURL,
			Path:     "/",
			HttpOnly: true,
			Secure:   false,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   600,
		})
	}

	authURL := h.oauthService.GetGitHubAuthURL(state)
	
	// For POST, return redirect URL as JSON
	if r.Method == "POST" {
		writeJSON(w, http.StatusOK, map[string]string{"url": authURL, "redirect": "true"})
		return
	}
	
	http.Redirect(w, r, authURL, http.StatusTemporaryRedirect)
}

// GitHubCallback handles the OAuth callback from GitHub
func (h *AuthHandler) GitHubCallback(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")

	// Validate state
	stateCookie, err := r.Cookie("oauth_state")
	if err != nil || stateCookie.Value != state {
		writeError(w, http.StatusBadRequest, "Invalid state")
		return
	}

	// Get callback URL
	callbackURL := h.clientURL
	if callbackCookie, err := r.Cookie("oauth_callback"); err == nil {
		callbackURL = callbackCookie.Value
	}

	// Clear OAuth cookies
	http.SetCookie(w, &http.Cookie{Name: "oauth_state", MaxAge: -1, Path: "/"})
	http.SetCookie(w, &http.Cookie{Name: "oauth_callback", MaxAge: -1, Path: "/"})

	// Exchange code for token
	accessToken, err := h.oauthService.ExchangeCode(r.Context(), code)
	if err != nil {
		fmt.Printf("[Auth] Exchange code failed: %v\n", err)
		writeError(w, http.StatusInternalServerError, "Failed to exchange code")
		return
	}

	// Get GitHub user
	ghUser, err := h.oauthService.GetGitHubUser(r.Context(), accessToken)
	if err != nil {
		fmt.Printf("[Auth] Get user failed: %v\n", err)
		writeError(w, http.StatusInternalServerError, "Failed to get user info")
		return
	}

	// Create or update user
	user, err := h.oauthService.CreateOrUpdateUser(r.Context(), ghUser, accessToken)
	if err != nil {
		fmt.Printf("[Auth] Create user failed: %v\n", err)
		writeError(w, http.StatusInternalServerError, "Failed to create user")
		return
	}

	// Create session
	token, err := h.oauthService.CreateSession(r.Context(), user.ID, r.RemoteAddr, r.UserAgent())
	if err != nil {
		fmt.Printf("[Auth] Create session failed: %v\n", err)
		writeError(w, http.StatusInternalServerError, "Failed to create session")
		return
	}

	// Set session cookie (better-auth compatible name)
	http.SetCookie(w, &http.Cookie{
		Name:     "better-auth.session_token",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   false, // Allow http for localhost
		SameSite: http.SameSiteLaxMode,
		MaxAge:   30 * 24 * 60 * 60, // 30 days
	})

	// Redirect to callback URL
	http.Redirect(w, r, callbackURL, http.StatusTemporaryRedirect)
}

// GetSession returns the current session
func (h *AuthHandler) GetSession(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("better-auth.session_token")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"session": nil, "user": nil})
		return
	}

	session, err := h.authService.ValidateSession(r.Context(), cookie.Value)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]interface{}{"session": nil, "user": nil})
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"session": map[string]interface{}{
			"id":        session.ID,
			"userId":    session.UserID,
			"expiresAt": time.Unix(session.ExpiresAt, 0).Format(time.RFC3339),
		},
		"user": map[string]interface{}{
			"id":    session.UserID,
			"name":  session.UserName,
			"email": session.UserEmail,
			"image": session.UserImage,
		},
	})
}

// SignOut invalidates the session
func (h *AuthHandler) SignOut(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("better-auth.session_token")
	if err == nil {
		h.authService.DeleteSession(r.Context(), cookie.Value)
	}

	// Clear cookie
	http.SetCookie(w, &http.Cookie{
		Name:   "better-auth.session_token",
		Value:  "",
		Path:   "/",
		MaxAge: -1,
	})

	writeJSON(w, http.StatusOK, map[string]bool{"success": true})
}
