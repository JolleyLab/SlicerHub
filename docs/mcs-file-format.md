# .mcs File Format Behaviour

## Background

Materialise Mimics exports case files with a `.mcs` extension. Originally these are
SQLite databases. When a user opens a `.mcs` file in the SlicerWeb case viewer and
clicks **Save**, Slicer writes back the current scene as a **Slicer scene bundle**
(a ZIP archive containing `scene.mrml` + NRRD/VTK data files) — the same format as
an `.mrb` file — under the same `.mcs` filename in Directus.

This means a single `.mcs` filename can hold two completely different file formats
depending on whether it has ever been saved through the SlicerWeb viewer:

| State | Internal format | Magic bytes |
|---|---|---|
| Original / never saved via SlicerWeb | SQLite database | `53 51 4C 69 74 65 20 66 6F 72 6D 61 74 20 33` (`SQLite format 3`) |
| Saved via SlicerWeb at least once | Slicer scene bundle (ZIP) | `50 4B 03 04` (`PK..`) |

## Load behaviour (as of Oct 2026)

`loadPendingIntoSlicerWeb` in `directus-cases-page.js` detects the format at load
time and chooses the appropriate reader:

1. Open the file as a ZIP. If it contains any `.mrml` entry → it is a Slicer scene
   bundle. Rename the VFS copy to `.mrb` and call
   `coreIOManager().loadNodes("SceneFile", ...)`.
2. Otherwise assume SQLite Mimics format and call
   `coreIOManager().loadNodes("MimicsProject", ...)`.

The `loadFiles()` bridge method is **not** used for Mimics files because
`LegacyScriptedFileReader.supportedNameFilters` is absent in the WASM build, which
causes `ImportMimicsFileReader.canLoadFileConfidence()` to always return 0.0, so
`fileType()` resolves to `VolumeFile` rather than `MimicsProject`.

## Open issue: save converts format irreversibly

Once a file is saved through SlicerWeb it is no longer a Mimics project file — it
is a Slicer scene bundle. Any Mimics-specific metadata that Slicer did not import
(e.g. masks, measurement data, Mimics object properties) is permanently lost.

**Decision needed:** should the Save path in SlicerWeb write back a Mimics SQLite
file (requires implementing Mimics export, not currently supported by SlicerHeart),
or is promotion to a Slicer scene bundle acceptable for the case review workflow?

Until this is decided, the load code handles both formats so cases remain openable
regardless of whether they have been saved before.
