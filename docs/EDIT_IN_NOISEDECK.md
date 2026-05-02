# Edit in Noisedeck Feature

## Overview
The "Edit in Noisedeck..." feature allows users to transfer their Polymorphic programs and custom effects to Noisedeck for further editing.

## Implementation Details

### Location
- Menu: Program → "edit in Noisedeck..."
- Handler: `handleEditInNoisedeck()` in `public/js/embed.js`

### What Gets Transported

1. **DSL Program**
   - Current DSL code from the editor
   - If available, includes current parameter values via `programState.toDsl()`

2. **Screenshot**
   - 1200x630 JPEG screenshot of the current render
   - Used as preview/thumbnail in Noisedeck

3. **Custom Effects** (if any)
   - All effects registered in the `user` namespace
   - Each effect is packaged as a ZIP containing:
     - `definition.json` - Effect metadata and configuration
     - `glsl/*.glsl` - GLSL shader files (if present)
     - `wgsl/*.wgsl` - WGSL shader files (if present)

### Transport Mechanism

Uses the sharing-is-caring service at `https://sharing.noisedeck.app`:
- Uploads payload to `/api/embed/shorten`
- Receives a short code
- Opens Noisedeck at `https://noisedeck.app/?code={shortCode}`
- Link TTL: 60 minutes

### Custom Effects Discovery

Unlike shade/foundry which use a `workspaceStore`, Polymorphic:
1. Calls `getAllEffects()` from the noisemaker bundle
2. Filters for `namespace === 'user'`
3. Reconstructs ZIP files from the registered effect data:
   - Effect definition from `effect.instance`
   - Shader code from `effect.instance.shaders`

### Effect ZIP Structure

Each custom effect ZIP contains:
```
definition.json          # Effect metadata
glsl/
  programName.glsl      # GLSL shaders (if present)
wgsl/
  programName.wgsl      # WGSL shaders (if present)
```

### Comparison with Other Implementations

**shade/** and **foundry/**:
- Use `workspaceStore.toObject()` to get files directly
- Files are already in the correct structure

**polymorphic/**:
- Uses `getAllEffects()` to get registered effects
- Must reconstruct ZIP files from effect data
- Supports both GLSL and WGSL shaders

## Usage

1. Create a program in Polymorphic
2. Optionally import custom effects from ZIP
3. Click Program → "edit in Noisedeck..."
4. Program opens in Noisedeck with all custom effects available

## Error Handling

- Warns if no DSL to edit
- Continues if screenshot capture fails
- Continues if effect ZIP creation fails
- Shows alert on upload failure
- All errors logged to console with `[Noisedeck]` prefix
