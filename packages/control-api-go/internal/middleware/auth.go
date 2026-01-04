package middleware

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/thakurdotdev/control-api/internal/services"
)

type contextKey string

const SessionContextKey contextKey = "session"

// AuthMiddleware validates session tokens
func AuthMiddleware(pool *pgxpool.Pool) func(http.Handler) http.Handler {
	// Create AuthService ONCE for this middleware instance
	authService := services.NewAuthService(pool)
	
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Get token from Authorization header or cookie
			token := extractToken(r)
			if token == "" {
				fmt.Printf("[Auth] ❌ No token for %s %s\n", r.Method, r.URL.Path)
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			session, err := authService.ValidateSession(r.Context(), token)
			if err != nil {
				fmt.Printf("[Auth] ❌ Validation failed for %s %s: %v\n", r.Method, r.URL.Path, err)
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			fmt.Printf("[Auth] ✅ Valid session for %s %s (user: %s)\n", r.Method, r.URL.Path, session.UserID)
			// Add session to context
			ctx := context.WithValue(r.Context(), SessionContextKey, session)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetSession retrieves session from context
func GetSession(ctx context.Context) *services.Session {
	session, ok := ctx.Value(SessionContextKey).(*services.Session)
	if !ok {
		return nil
	}
	return session
}

func extractToken(r *http.Request) string {
	// Try Authorization header first
	auth := r.Header.Get("Authorization")
	if auth != "" {
		if strings.HasPrefix(auth, "Bearer ") {
			return strings.TrimPrefix(auth, "Bearer ")
		}
		return auth
	}

	// Try query parameter (for SSE/EventSource which may not send cookies)
	if token := r.URL.Query().Get("token"); token != "" {
		return token
	}

	// Fall back to cookie
	cookie, err := r.Cookie("better-auth.session_token")
	if err == nil && cookie.Value != "" {
		return cookie.Value
	}

	return ""
}
