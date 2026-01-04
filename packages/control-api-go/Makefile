.PHONY: build run dev test clean deps generate

# Build the binary
build:
	go build -o bin/control-api ./cmd/api

# Run in development
run:
	go run ./cmd/api

# Run with hot reload (requires air)
dev:
	air

# Run tests
test:
	go test -v ./...

# Clean build artifacts
clean:
	rm -rf bin/

# Download dependencies
deps:
	go mod download
	go mod tidy

# Generate sqlc code
generate:
	sqlc generate

# Build for production (optimized)
build-prod:
	CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o bin/control-api ./cmd/api
