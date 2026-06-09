# Artifex Backend (Go) Makefile
# Go SDK path: C:\Users\29623\sdk\go1.26.4
# Override GO if your go binary is elsewhere

GO ?= go
GOFLAGS ?=
LDFLAGS ?= -s -w

.PHONY: all run build build-noonx build-windows clean dist

all: build

# ── Development ───────────────────────────────────────────────────────────

run:
	$(GO) run $(GOFLAGS) -tags noonx . -host 127.0.0.1 -port 8000

# ── Build ─────────────────────────────────────────────────────────────────

# Default build with ONNX Runtime support (requires CGO + onnxruntime shared lib)
build:
	CGO_ENABLED=1 $(GO) build $(GOFLAGS) -ldflags "$(LDFLAGS)" -o artifex-server.exe .

# Pure Go build without ONNX Runtime (no CGO required, zero deps)
build-noonx:
	CGO_ENABLED=0 $(GO) build $(GOFLAGS) -tags noonx -ldflags "$(LDFLAGS)" -o artifex-server-noonx.exe .

# Cross-compile for Windows from Linux/macOS (pure Go, no ONNX)
build-windows:
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 $(GO) build -tags noonx -ldflags "$(LDFLAGS)" -o artifex-server.exe .

# Cross-compile for Linux (pure Go, no ONNX)
build-linux:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 $(GO) build -tags noonx -ldflags "$(LDFLAGS)" -o artifex-server .

# ── Distribution ──────────────────────────────────────────────────────────

# Prepare distribution directory
dist: build-noonx
	rm -rf dist/Artifex
	mkdir -p dist/Artifex/models/default dist/Artifex/models/user_model dist/Artifex/uploads
	cp artifex-server-noonx.exe dist/Artifex/Artifex.exe
	cp settings.json dist/Artifex/
	@echo
	@echo "Distribution prepared in dist/Artifex/"
	@echo "To include frontend, copy frontend/build/ to dist/Artifex/_internal/frontend/"

# Full distribution with frontend
dist-full: build-noonx
	rm -rf dist/Artifex
	mkdir -p dist/Artifex/_internal/frontend dist/Artifex/models/default dist/Artifex/models/user_model dist/Artifex/uploads
	cp artifex-server-noonx.exe dist/Artifex/Artifex.exe
	cp settings.json dist/Artifex/
	cp -r ../frontend/build/* dist/Artifex/_internal/frontend/
	@echo
	@echo "Full distribution prepared in dist/Artifex/"
	@echo "  dist/Artifex/Artifex.exe          — server binary"
	@echo "  dist/Artifex/_internal/frontend/  — React frontend"
	@echo "  dist/Artifex/settings.json        — default config"
	@echo "  dist/Artifex/models/              — ONNX model storage"
	@echo "  dist/Artifex/uploads/             — user uploads"

# ── Clean ─────────────────────────────────────────────────────────────────

clean:
	rm -f artifex-server.exe artifex-server-noonx.exe
	rm -rf dist/
