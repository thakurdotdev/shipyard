.PHONY: build run dev test clean

# Build the binary
build:
	go build -o bin/deploy-engine ./cmd/engine

# Run in development
run:
	go run -gcflags="all=-N -l" ./cmd/engine

# Run with hot reload (requires air: go install github.com/air-verse/air@latest)
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

# Build for production (optimized)
build-prod:
	CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o bin/deploy-engine ./cmd/engine
