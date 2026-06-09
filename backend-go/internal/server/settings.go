package server

import (
	"encoding/json"
	"net/http"

	"artifex-backend/internal/settings"
	"artifex-backend/internal/tagger"
)

// ── Get Settings ────────────────────────────────────────────────────────

func (s *Server) GetSettings(w http.ResponseWriter, r *http.Request) {
	st, err := settings.Load(s.SettingsPath())
	if err != nil {
		writeError(w, 500, "Failed to load settings")
		return
	}
	writeJSON(w, 200, st)
}

// ── Update Settings ─────────────────────────────────────────────────────

func (s *Server) UpdateSettings(w http.ResponseWriter, r *http.Request) {
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "Invalid request body")
		return
	}

	current, err := settings.Load(s.SettingsPath())
	if err != nil {
		writeError(w, 500, "Failed to load settings")
		return
	}

	allowed := map[string]bool{"auto_tag": true, "gpu_enabled": true, "active_model": true}
	for key, val := range body {
		if !allowed[key] {
			continue
		}
		switch key {
		case "auto_tag":
			if b, ok := val.(bool); ok {
				current.AutoTag = b
			}
		case "gpu_enabled":
			if b, ok := val.(bool); ok {
				current.GPUEnabled = b
				tagger.SetUseGPU(b)
			}
		case "active_model":
			if s, ok := val.(string); ok {
				current.ActiveModel = s
				tagger.SetActiveModel(s)
			}
		}
	}

	if err := settings.Save(s.SettingsPath(), current); err != nil {
		writeError(w, 500, "Failed to save settings")
		return
	}

	writeJSON(w, 200, current)
}
