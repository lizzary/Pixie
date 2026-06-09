//go:build noonx
// +build noonx

package tagger

import (
	"image"
	"os"
)

// Stub implementation — no ONNX Runtime support.
// ExtractTags always returns empty tags.

func clearTaggerCache() {}

func LoadTagger(modelsDir string) error {
	return nil
}

func ExtractTags(img image.Image) string {
	return ""
}

// Helper needed by LoadTagger stub
func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
