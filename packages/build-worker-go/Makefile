.PHONY: build run dev test clean deps build-prod

# Build the binary
build:
	go build -o bin/build-worker ./cmd/worker

# Run in development
run:
	go run ./cmd/worker

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

# Build for production (optimized)
build-prod:
	CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o bin/build-worker ./cmd/worker
