package metadata

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ── PNG Chunk Reading ────────────────────────────────────────────────────

// ReadPNGTextChunks reads text chunks (tEXt, iTXt, zTXt) from a PNG file.
// Returns a map of keyword → text content.
func ReadPNGTextChunks(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	// Verify PNG signature
	sig := make([]byte, 8)
	if _, err := io.ReadFull(f, sig); err != nil {
		return nil, fmt.Errorf("not a PNG file")
	}
	if binary.BigEndian.Uint64(sig) != 0x89504E470D0A1A0A {
		return nil, fmt.Errorf("invalid PNG signature")
	}

	chunks := make(map[string]string)

	for {
		// Read chunk length (4 bytes, big-endian)
		var length uint32
		if err := binary.Read(f, binary.BigEndian, &length); err != nil {
			break // EOF or error, done reading
		}

		// Read chunk type (4 bytes)
		chunkType := make([]byte, 4)
		if _, err := io.ReadFull(f, chunkType); err != nil {
			break
		}

		// Read chunk data
		data := make([]byte, length)
		if _, err := io.ReadFull(f, data); err != nil {
			break
		}

		// Skip CRC (4 bytes)
		crc := make([]byte, 4)
		io.ReadFull(f, crc)

		t := string(chunkType)
		switch t {
		case "tEXt":
			// NULL-separated keyword + text
			parts := strings.SplitN(string(data), "\x00", 2)
			if len(parts) == 2 {
				chunks[parts[0]] = parts[1]
			}
		case "iTXt", "zTXt":
			// More complex, but for our purposes we attempt keyword extraction
			parts := strings.SplitN(string(data), "\x00", 2)
			if len(parts) >= 1 {
				keyword := parts[0]
				// For iTXt: keyword\0compression\0method\0language\0translatedKeyword\0text
				// For zTXt: keyword\0compression\0compressedText
				if t == "iTXt" && len(parts) > 1 {
					// Simple extraction: take everything after the last null
					lastNull := strings.LastIndex(string(data), "\x00")
					if lastNull >= 0 && lastNull < len(data)-1 {
						chunks[keyword] = string(data[lastNull+1:])
					}
				}
			}
		case "IEND":
			return chunks, nil
		}
	}

	return chunks, nil
}

// ── Constants ────────────────────────────────────────────────────────────

var positiveKeywords = []string{
	"positive", "masterpiece", "best quality", "high quality",
	"detailed", "beautiful", "amazing", "stunning", "perfect",
	"photorealistic", "professional", "artistic", "elegant",
}

var negativeKeywords = []string{
	"negative", "bad", "worst quality", "low quality", "poor quality",
	"blurry", "distorted", "ugly", "deformed", "artifact", "noise",
	"overexposed", "underexposed", "cropped", "out of frame",
}

var strongNegative = []string{
	"worst quality", "low quality", "bad", "ugly", "blurry",
	"distorted", "deformed", "amateur", "poor quality",
}

var strongPositive = []string{
	"masterpiece", "best quality", "high quality", "detailed",
	"professional", "photorealistic", "stunning", "beautiful",
}

var samplerNodeTypes = map[string]bool{
	"KSampler": true, "SamplerCustom": true, "FaceDetailerPipe": true,
}

var modelLoaderTypes = map[string]bool{
	"CheckpointLoaderSimple": true, "CheckpointLoader|pysssss": true,
	"ModelLoader": true, "CheckpointLoader": true,
}

var loraLoaderTypes = map[string]bool{
	"LoraLoader": true, "Power Lora Loader (rgthree)": true,
}

var workflowModelTypes = []string{
	"CheckpointLoaderSimple", "CheckpointLoader|pysssss", "ModelLoader",
	"CheckpointLoader", "UnetLoaderGGUF", "DualCLIPLoaderGGUF",
	"UNETLoader", "UnetLoaderGGML", "UnetLoaderGGMLv3",
}

// ── Public API ───────────────────────────────────────────────────────────

func Extract(imagePath string, img image.Image) (map[string]interface{}, error) {
	result := make(map[string]interface{})

	// Build fileinfo
	fileInfo := buildFileInfo(imagePath, img)
	result["fileinfo"] = fileInfo

	// Read PNG chunks
	chunks, err := ReadPNGTextChunks(imagePath)
	if err != nil {
		// Not a PNG or can't read — return fileinfo only
		return result, nil
	}

	var promptObj map[string]interface{}
	var workflowObj map[string]interface{}

	if promptStr, ok := chunks["prompt"]; ok {
		json.Unmarshal([]byte(promptStr), &promptObj)
	}
	if workflowStr, ok := chunks["workflow"]; ok {
		json.Unmarshal([]byte(workflowStr), &workflowObj)
	}

	// Find sampler node ID
	var samplerNodeID string
	if promptObj != nil {
		for k, node := range promptObj {
			if n, ok := node.(map[string]interface{}); ok {
				ct := getStringField(n, "class_type")
				if ct == "" {
					ct = getStringField(n, "type")
				}
				if samplerNodeTypes[ct] {
					samplerNodeID = k
					break
				}
			}
		}
	}

	// Model
	model := ""
	if promptObj != nil {
		model = extractModelFromPrompt(promptObj)
	}
	if model == "" && workflowObj != nil {
		model = extractModelFromWorkflow(workflowObj)
	}
	result["Model"] = model

	// Seed
	seed := ""
	if promptObj != nil && samplerNodeID != "" {
		seed = extractSeedFromPrompt(promptObj, samplerNodeID)
	}
	if seed == "" && workflowObj != nil {
		seed = extractSeedFromWorkflow(workflowObj)
	}
	result["Seed"] = seed

	// Positive Prompt
	positive := ""
	if promptObj != nil && samplerNodeID != "" {
		positive = extractPositivePromptFromPrompt(promptObj, samplerNodeID)
	}
	if positive == "" && promptObj != nil {
		positive, _ = extractPromptsHeuristic(promptObj)
	}
	if positive == "" && workflowObj != nil {
		positive, _ = extractPromptsFromWorkflow(workflowObj)
	}
	result["Positive Prompt"] = positive

	// Negative Prompt
	negative := ""
	if promptObj != nil {
		_, negative = extractPromptsHeuristic(promptObj)
	}
	if negative == "" && workflowObj != nil {
		_, negative = extractPromptsFromWorkflow(workflowObj)
	}
	result["Negative Prompt"] = negative

	// Sampler
	sampler := ""
	if promptObj != nil {
		params := extractParametersFromPrompt(promptObj)
		if s, ok := params["sampler_name"]; ok {
			sampler = s
		}
	}
	if sampler == "" && workflowObj != nil {
		wfParams := extractParametersFromWorkflow(workflowObj)
		if s, ok := wfParams["sampler"]; ok {
			sampler = s
		}
	}
	result["Sampler"] = sampler

	// Scheduler
	scheduler := ""
	if promptObj != nil {
		params := extractParametersFromPrompt(promptObj)
		if s, ok := params["scheduler"]; ok {
			scheduler = s
		}
	}
	if scheduler == "" && workflowObj != nil {
		wfParams := extractParametersFromWorkflow(workflowObj)
		if s, ok := wfParams["scheduler"]; ok {
			scheduler = s
		}
	}
	result["Scheduler"] = scheduler

	// Steps
	steps := ""
	if promptObj != nil {
		params := extractParametersFromPrompt(promptObj)
		if s, ok := params["steps"]; ok {
			steps = s
		}
	}
	if steps == "" && workflowObj != nil {
		wfParams := extractParametersFromWorkflow(workflowObj)
		if s, ok := wfParams["steps"]; ok {
			steps = s
		}
	}
	result["Steps"] = steps

	// CFG Scale
	cfg := ""
	if promptObj != nil {
		params := extractParametersFromPrompt(promptObj)
		if c, ok := params["cfg"]; ok {
			cfg = c
		}
	}
	if cfg == "" && workflowObj != nil {
		wfParams := extractParametersFromWorkflow(workflowObj)
		if c, ok := wfParams["cfg"]; ok {
			cfg = c
		}
	}
	result["CFG Scale"] = cfg

	// LoRAs
	loras := extractLoraListFromPrompt(promptObj)
	if len(loras) > 0 {
		var loraStrs []string
		for _, lora := range loras {
			if name, ok := lora["name"].(string); ok && name != "" {
				loraStrs = append(loraStrs, fmt.Sprintf("%s (Model: %v, Clip: %v)",
					name, lora["model_strength"], lora["clip_strength"]))
			}
		}
		if len(loraStrs) > 0 {
			result["LoRAs"] = strings.Join(loraStrs, ", ")
		} else {
			result["LoRAs"] = "N/A"
		}
	} else {
		result["LoRAs"] = "N/A"
	}

	// Deduplicate identical positive/negative
	if positive == negative && positive != "" {
		result["Negative Prompt"] = ""
	}

	return result, nil
}

// ── File Info ────────────────────────────────────────────────────────────

func buildFileInfo(path string, img image.Image) map[string]interface{} {
	bounds := img.Bounds()
	info, _ := os.Stat(path)
	return map[string]interface{}{
		"filename":   filepath.ToSlash(path),
		"resolution": fmt.Sprintf("%dx%d", bounds.Dx(), bounds.Dy()),
		"date":       info.ModTime().String(),
		"size":       formatSize(info.Size()),
	}
}

func formatSize(bytes int64) string {
	switch {
	case bytes < 1024:
		return fmt.Sprintf("%d bytes", bytes)
	case bytes < 1024*1024:
		return fmt.Sprintf("%.2f KB", float64(bytes)/1024.0)
	default:
		return fmt.Sprintf("%.2f MB", float64(bytes)/(1024.0*1024.0))
	}
}

// ── Prompt Extraction ────────────────────────────────────────────────────

func isPlainPromptString(val interface{}) (string, bool) {
	s, ok := val.(string)
	if !ok || strings.TrimSpace(s) == "" {
		return "", false
	}
	trimmed := strings.TrimSpace(s)
	if (strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}")) ||
		(strings.HasPrefix(trimmed, "[") && strings.HasSuffix(trimmed, "]")) {
		return "", false
	}
	if len(trimmed) > 2000 && len(strings.Split(trimmed, ",")) > 100 {
		return "", false
	}
	return trimmed, true
}

func isPositivePrompt(text string) bool {
	if text == "" {
		return false
	}
	lower := strings.ToLower(text)
	for _, k := range strongNegative {
		if strings.Contains(lower, k) {
			return false
		}
	}
	for _, k := range strongPositive {
		if strings.Contains(lower, k) {
			return true
		}
	}
	pos := 0
	for _, k := range positiveKeywords {
		if strings.Contains(lower, k) {
			pos++
		}
	}
	neg := 0
	for _, k := range negativeKeywords {
		if strings.Contains(lower, k) {
			neg++
		}
	}
	if len(text) > 50 {
		pos++
	}
	return pos > neg && pos > 0
}

func isNegativePrompt(text string) bool {
	if text == "" {
		return false
	}
	lower := strings.ToLower(text)
	for _, k := range strongNegative {
		if strings.Contains(lower, k) {
			return true
		}
	}
	neg := 0
	for _, k := range negativeKeywords {
		if strings.Contains(lower, k) {
			neg++
		}
	}
	pos := 0
	for _, k := range positiveKeywords {
		if strings.Contains(lower, k) {
			pos++
		}
	}
	if neg > pos && neg > 0 {
		return true
	}
	if len(text) < 100 && neg > 0 {
		return true
	}
	return false
}

// ── Prompt Object Helpers ────────────────────────────────────────────────

func getStringField(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func getMapField(m map[string]interface{}, key string) map[string]interface{} {
	if v, ok := m[key]; ok {
		if mv, ok := v.(map[string]interface{}); ok {
			return mv
		}
	}
	return nil
}

func getMapSliceField(m map[string]interface{}, key string) []interface{} {
	if v, ok := m[key]; ok {
		if mv, ok := v.([]interface{}); ok {
			return mv
		}
	}
	return nil
}

// ── Model Extraction ─────────────────────────────────────────────────────

func extractModelFromPrompt(promptObj map[string]interface{}) string {
	var resolve func(ref interface{}, visited map[interface{}]bool) string
	resolve = func(ref interface{}, visited map[interface{}]bool) string {
		if ref == nil {
			return ""
		}
		if visited[ref] {
			return ""
		}
		visited[ref] = true

		// String ref
		if s, ok := ref.(string); ok {
			if strings.HasSuffix(strings.ToLower(s), ".safetensors") || strings.HasSuffix(strings.ToLower(s), ".ckpt") {
				return s
			}
			return ""
		}

		// Object with content field
		if m, ok := ref.(map[string]interface{}); ok {
			if content, ok := m["content"].(string); ok {
				if strings.HasSuffix(strings.ToLower(content), ".safetensors") || strings.HasSuffix(strings.ToLower(content), ".ckpt") {
					return content
				}
			}
		}

		// Array ref [nodeID, ...]
		if arr, ok := ref.([]interface{}); ok && len(arr) > 0 {
			if nodeID, ok := arr[0].(string); ok {
				if node, ok := promptObj[nodeID].(map[string]interface{}); ok {
					ct := getStringField(node, "class_type")
					if ct == "" {
						ct = getStringField(node, "type")
					}
					inputs := getMapField(node, "inputs")
					if inputs == nil {
						return ""
					}
					if loraLoaderTypes[ct] {
						if modelRef, ok := inputs["model"]; ok {
							return resolve(modelRef, visited)
						}
					}
					if modelLoaderTypes[ct] {
						if ckptName, ok := inputs["ckpt_name"]; ok {
							return resolve(ckptName, visited)
						}
					}
					for _, val := range inputs {
						if result := resolve(val, visited); result != "" {
							return result
						}
					}
				}
			}
		}
		return ""
	}

	for _, node := range promptObj {
		if n, ok := node.(map[string]interface{}); ok {
			ct := getStringField(n, "class_type")
			if ct == "" {
				ct = getStringField(n, "type")
			}
			inputs := getMapField(n, "inputs")
			if inputs == nil {
				continue
			}
			if modelLoaderTypes[ct] {
				if ckptName, ok := inputs["ckpt_name"]; ok {
					if result := resolve(ckptName, map[interface{}]bool{}); result != "" {
						return result
					}
				}
			}
			if loraLoaderTypes[ct] {
				if modelRef, ok := inputs["model"]; ok {
					if result := resolve(modelRef, map[interface{}]bool{}); result != "" {
						return result
					}
				}
			}
			for _, val := range inputs {
				if result := resolve(val, map[interface{}]bool{}); result != "" {
					return result
				}
			}
		}
	}
	return ""
}

func extractModelFromWorkflow(workflowObj map[string]interface{}) string {
	nodes := getMapSliceField(workflowObj, "nodes")
	for _, node := range nodes {
		n, ok := node.(map[string]interface{})
		if !ok {
			continue
		}
		nt := getStringField(n, "type")
		for _, mt := range workflowModelTypes {
			if nt == mt {
				wv := getMapSliceField(n, "widgets_values")
				if len(wv) > 0 {
					if s, ok := wv[0].(string); ok {
						return s
					}
					if m, ok := wv[0].(map[string]interface{}); ok {
						if content, ok := m["content"].(string); ok {
							return content
						}
					}
				}
			}
		}
	}
	return ""
}

// ── Seed Extraction ──────────────────────────────────────────────────────

func extractSeedFromPrompt(promptObj map[string]interface{}, samplerNodeID string) string {
	sampler, ok := promptObj[samplerNodeID].(map[string]interface{})
	if !ok {
		return ""
	}
	inputs := getMapField(sampler, "inputs")
	if inputs == nil {
		return ""
	}

	seedInput, ok := inputs["seed"]
	if !ok {
		return ""
	}

	// Direct int/float
	if v, ok := toFloat(seedInput); ok {
		return formatInt(v)
	}
	// String
	if s, ok := seedInput.(string); ok {
		return s
	}
	// Array ref
	if arr, ok := seedInput.([]interface{}); ok && len(arr) > 0 {
		if nodeID, ok := arr[0].(string); ok {
			refNode, ok := promptObj[nodeID].(map[string]interface{})
			if !ok {
				return ""
			}
			refInputs := getMapField(refNode, "inputs")
			if refInputs == nil {
				return ""
			}
			for _, key := range []string{"seed", "text", "value"} {
				if v, ok := toFloat(refInputs[key]); ok {
					return formatInt(v)
				}
				if s, ok := refInputs[key].(string); ok {
					return s
				}
			}
		}
	}
	return ""
}

func extractSeedFromWorkflow(workflowObj map[string]interface{}) string {
	// Simplified: find KSampler node and extract seed from widgets_values
	nodes := getMapSliceField(workflowObj, "nodes")
	for _, node := range nodes {
		n, ok := node.(map[string]interface{})
		if !ok {
			continue
		}
		nt := getStringField(n, "type")
		if nt == "KSampler" || nt == "SamplerCustom" {
			wv := getMapSliceField(n, "widgets_values")
			if len(wv) > 0 {
				if v, ok := toFloat(wv[0]); ok {
					return formatInt(v)
				}
			}
		}
	}
	return ""
}

// ── Prompt String Extraction ─────────────────────────────────────────────

func resolvePromptString(promptObj map[string]interface{}, ref interface{}) (string, bool) {
	if ref == nil {
		return "", false
	}
	if s, ok := ref.(string); ok {
		if trimmed, ok := isPlainPromptString(s); ok {
			return trimmed, true
		}
	}
	if m, ok := ref.(map[string]interface{}); ok {
		if content, ok := m["content"].(string); ok {
			if trimmed, ok := isPlainPromptString(content); ok {
				return trimmed, true
			}
		}
	}
	if arr, ok := ref.([]interface{}); ok && len(arr) > 0 {
		if nodeID, ok := arr[0].(string); ok {
			if node, ok := promptObj[nodeID].(map[string]interface{}); ok {
				inputs := getMapField(node, "inputs")
				if inputs == nil {
					return "", false
				}
				for _, key := range []string{"text", "prompt"} {
					if val, exists := inputs[key]; exists {
						if result, ok := resolvePromptString(promptObj, val); ok {
							return result, true
						}
					}
				}
			}
		}
	}
	return "", false
}

func extractPositivePromptFromPrompt(promptObj map[string]interface{}, samplerNodeID string) string {
	sampler, ok := promptObj[samplerNodeID].(map[string]interface{})
	if !ok {
		return ""
	}
	inputs := getMapField(sampler, "inputs")
	if inputs == nil {
		return ""
	}

	posInput, ok := inputs["positive"]
	if !ok {
		return ""
	}

	if result, ok := resolvePromptString(promptObj, posInput); ok {
		if isPositivePrompt(result) {
			return result
		}
	}
	return ""
}

type candidate struct {
	value    string
	priority int
}

func extractPromptsHeuristic(promptObj map[string]interface{}) (string, string) {
	var posCandidates, negCandidates []candidate
	var crPositive, crNegative string

	for _, node := range promptObj {
		n, ok := node.(map[string]interface{})
		if !ok {
			continue
		}
		ct := getStringField(n, "class_type")
		if ct == "" {
			ct = getStringField(n, "type")
		}
		inputs := getMapField(n, "inputs")
		if inputs == nil {
			continue
		}

		// Check for prompt/text fields
		for _, key := range []string{"prompt", "text"} {
			val := inputs[key]
			if val == nil {
				continue
			}

			// Direct string
			if s, ok := val.(string); ok {
				if trimmed, ok := isPlainPromptString(s); ok {
					if isPositivePrompt(trimmed) {
						priority := 0
						if ct == "CLIPTextEncode" {
							priority = 2
						}
						posCandidates = append(posCandidates, candidate{trimmed, priority})
					}
					if isNegativePrompt(trimmed) {
						priority := 0
						if ct == "CLIPTextEncode" {
							priority = 2
						}
						negCandidates = append(negCandidates, candidate{trimmed, priority})
					}
				}
			}

			// Resolve through references
			if result, ok := resolvePromptString(promptObj, val); ok {
				if isPositivePrompt(result) {
					priority := 0
					if ct == "CLIPTextEncode" {
						priority = 2
					}
					posCandidates = append(posCandidates, candidate{result, priority})
				}
				if isNegativePrompt(result) {
					priority := 0
					if ct == "CLIPTextEncode" {
						priority = 2
					}
					negCandidates = append(negCandidates, candidate{result, priority})
				}
			}
		}
	}

	// Select best candidates
	var positive, negative string
	if crPositive != "" {
		positive = crPositive
	} else {
		// Sort by priority descending
		sortCandidates(posCandidates)
		if len(posCandidates) > 0 {
			positive = posCandidates[0].value
		}
	}

	if crNegative != "" {
		negative = crNegative
	} else {
		sortCandidates(negCandidates)
		if len(negCandidates) > 0 {
			negative = negCandidates[0].value
		}
	}

	return positive, negative
}

func sortCandidates(c []candidate) {
	for i := 0; i < len(c); i++ {
		for j := i + 1; j < len(c); j++ {
			if c[i].priority < c[j].priority {
				c[i], c[j] = c[j], c[i]
			}
		}
	}
}

// ── Workflow Prompt Extraction ───────────────────────────────────────────

func extractPromptsFromWorkflow(workflowObj map[string]interface{}) (string, string) {
	nodes := getMapSliceField(workflowObj, "nodes")
	// Find a sampler node and trace its positive/negative inputs
	for _, node := range nodes {
		n, ok := node.(map[string]interface{})
		if !ok {
			continue
		}
		nt := getStringField(n, "type")
		if nt == "KSampler" || nt == "SamplerCustom" {
			inputs := getMapSliceField(n, "inputs")
			var posLinkID, negLinkID float64
			for _, inp := range inputs {
				if m, ok := inp.(map[string]interface{}); ok {
					name := getStringField(m, "name")
					if name == "positive" {
						if link, ok := toFloat(m["link"]); ok {
							posLinkID = link
						}
					}
					if name == "negative" {
						if link, ok := toFloat(m["link"]); ok {
							negLinkID = link
						}
					}
				}
			}
			positive := resolvePromptFromGraph(nodes, posLinkID)
			negative := resolvePromptFromGraph(nodes, negLinkID)
			return positive, negative
		}
	}
	return "", ""
}

func resolvePromptFromGraph(nodes []interface{}, linkID float64) string {
	if linkID == 0 {
		return ""
	}
	// Find source node connected to this link
	for _, node := range nodes {
		n, ok := node.(map[string]interface{})
		if !ok {
			continue
		}
		outputs := getMapSliceField(n, "outputs")
		for _, out := range outputs {
			if m, ok := out.(map[string]interface{}); ok {
				links := getMapSliceField(m, "links")
				for _, l := range links {
					if v, ok := toFloat(l); ok && v == linkID {
						// Found the source node — extract prompt text
						wv := getMapSliceField(n, "widgets_values")
						if len(wv) > 0 {
							if s, ok := wv[0].(string); ok {
								if trimmed, ok := isPlainPromptString(s); ok {
									return trimmed
								}
							}
						}
					}
				}
			}
		}
	}
	return ""
}

// ── Parameters Extraction ────────────────────────────────────────────────

func extractParametersFromPrompt(promptObj map[string]interface{}) map[string]string {
	params := make(map[string]string)
	for _, node := range promptObj {
		n, ok := node.(map[string]interface{})
		if !ok {
			continue
		}
		ct := getStringField(n, "class_type")
		if ct == "" {
			ct = getStringField(n, "type")
		}
		inputs := getMapField(n, "inputs")
		if inputs == nil {
			continue
		}
		if samplerNodeTypes[ct] {
			for _, key := range []string{"steps", "cfg", "sampler_name", "scheduler"} {
				if v, ok := toFloat(inputs[key]); ok {
					params[key] = formatFloat(v)
				} else if s, ok := inputs[key].(string); ok {
					params[key] = s
				}
			}
		}
		if modelLoaderTypes[ct] {
			if ckpt, ok := inputs["ckpt_name"]; ok {
				if s, ok := ckpt.(string); ok {
					params["model"] = s
				} else if m, ok := ckpt.(map[string]interface{}); ok {
					if content, ok := m["content"].(string); ok {
						params["model"] = content
					}
				}
			}
		}
	}
	return params
}

func extractParametersFromWorkflow(workflowObj map[string]interface{}) map[string]string {
	params := make(map[string]string)
	nodes := getMapSliceField(workflowObj, "nodes")
	for _, node := range nodes {
		n, ok := node.(map[string]interface{})
		if !ok {
			continue
		}
		nt := getStringField(n, "type")
		if nt == "KSampler" || nt == "SamplerCustom" || nt == "FaceDetailerPipe" {
			wv := getMapSliceField(n, "widgets_values")
			inputs := getMapField(n, "inputs")

			if len(wv) > 2 {
				if v, ok := toFloat(wv[2]); ok {
					params["steps"] = formatInt(v)
				}
			} else if inputs != nil {
				if v, ok := toFloat(inputs["steps"]); ok {
					params["steps"] = formatInt(v)
				}
			}

			if len(wv) > 3 {
				if v, ok := toFloat(wv[3]); ok {
					params["cfg"] = formatFloat(v)
				}
			} else if inputs != nil {
				if v, ok := toFloat(inputs["cfg"]); ok {
					params["cfg"] = formatFloat(v)
				}
			}

			if len(wv) > 4 {
				if s, ok := wv[4].(string); ok {
					params["sampler"] = s
				}
			} else if inputs != nil {
				if s, ok := inputs["sampler_name"].(string); ok {
					params["sampler"] = s
				}
			}

			if len(wv) > 5 {
				if s, ok := wv[5].(string); ok {
					params["scheduler"] = s
				}
			}
		}
	}
	return params
}

// ── LoRA Extraction ──────────────────────────────────────────────────────

func extractLoraListFromPrompt(promptObj map[string]interface{}) []map[string]interface{} {
	var loras []map[string]interface{}
	for _, node := range promptObj {
		n, ok := node.(map[string]interface{})
		if !ok {
			continue
		}
		ct := getStringField(n, "class_type")
		if ct == "" {
			ct = getStringField(n, "type")
		}
		inputs := getMapField(n, "inputs")
		if inputs == nil {
			continue
		}
		// Power Lora Loader style (lora_1, lora_2, ...)
		for key, val := range inputs {
			if strings.HasPrefix(key, "lora_") {
				if m, ok := val.(map[string]interface{}); ok {
					if on, _ := m["on"].(bool); on {
						if lora, _ := m["lora"].(string); lora != "" {
							loras = append(loras, map[string]interface{}{
								"name":           lora,
								"model_strength": m["strength"],
								"clip_strength":  m["strengthTwo"],
							})
						}
					}
				}
			}
		}
		// LoraLoader style
		if loraLoaderTypes[ct] {
			if loraName, ok := inputs["lora_name"].(string); ok {
				loras = append(loras, map[string]interface{}{
					"name":           loraName,
					"model_strength": inputs["strength_model"],
					"clip_strength":  inputs["strength_clip"],
				})
			}
		}
	}
	return loras
}

// ── Type Conversion Helpers ──────────────────────────────────────────────

func toFloat(v interface{}) (float64, bool) {
	switch val := v.(type) {
	case float64:
		return val, true
	case float32:
		return float64(val), true
	case int:
		return float64(val), true
	case int64:
		return float64(val), true
	case int32:
		return float64(val), true
	case json.Number:
		f, err := val.Float64()
		return f, err == nil
	}
	return 0, false
}

func formatInt(v float64) string {
	return fmt.Sprintf("%d", int64(v))
}

func formatFloat(v float64) string {
	return fmt.Sprintf("%v", v)
}
