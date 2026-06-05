# Forma v6 11: UI Canvas Spec

## Source Design Scope

- DESIGN v6 sections: `后台 UI 调整`, `后台图谱画布交互模型`, `后台设计页画布渲染模型`, `Web / Server API 调整` front-end behavior, `实施顺序` step 11.
- DESIGN v6 acceptance IDs: 5, 41, 42, 43, 44, 45, 46, 47, 48, 52.
- Depends on: `2026-05-21-forma-v6-10-server-web-routes-design.md`.

## Goal

Replace screenshot-overlay design inspection with a requirement-level scene canvas driven by `get_requirement_design_scene`, add infinite canvas interaction, structured selection, property inspection, real screenshot comparison, accessibility, responsive behavior, i18n, and navigation graph pan/zoom.

## Non-Goals

- Do not edit or save `.pen` files from the Web canvas.
- Do not treat LeaferJS rendering as a pixel-perfect Pencil replacement.
- Do not use screenshots for hit testing.
- Do not leave production `AnnotationCanvas` as a runtime entry.
- Do not hardcode new UI strings outside i18n maps.

## Requirement Detail UI

Requirement detail page must show:

- main design canvas entry,
- formal `design.pen` path or display path,
- pinned component library version,
- product latest component library version,
- active design session state,
- Pencil App page/operation being drawn,
- elapsed time,
- Pencil process/session status,
- lock owner details,
- latest main canvas index result,
- latest component usage index result,
- component refresh preflight result,
- latest Design Quality Pipeline result,
- AI screenshot review status.

When a lock/session exists, buttons must not silently do nothing. UI displays structured session state such as:

```text
Pencil App 正在绘制 scenes，Pencil 进程 PID 70604，已运行 03:12
```

The text is localized and assembled from structured fields.

## DesignSceneCanvas

Create `DesignSceneCanvas` using LeaferJS.

Input:

- `RequirementDesignScene`,
- selected `page_id`,
- optional selected node ids,
- unsupported property warnings,
- preview state.

Render supported node features:

- frame,
- rect,
- text,
- image,
- base fill,
- stroke,
- corner radius,
- opacity,
- z-order,
- absolute coordinates,
- basic transform where supported.

Hit testing, hover, selection, and box selection bind to Pencil `node_id`.
No screenshot coordinate mapping is allowed.

## Infinite Canvas Interactions

Design canvas supports:

- drag pan,
- wheel zoom,
- fit page,
- fit selection,
- 100% zoom,
- reset view,
- page frame location.

Graph canvases for navigation, requirement page relationships, and future component usage use the same interaction habits:

- pan,
- zoom,
- fit graph,
- fit selection,
- 100% zoom,
- reset view.

Graph data remains Forma layout data and does not come from previews or screenshots.

## PropertyPanel

PropertyPanel shows selected node information from scene payload:

- Pencil path,
- `node_id`,
- geometry,
- text,
- image,
- fill/stroke,
- component/ref details,
- usage index details,
- unsupported properties,
- export actions.

Multi-select supports spacing measurement from `.pen` coordinates and also renders the measurement as readable text.

Export links call requirement-level `design/export` with `node_id` and `format`.

## Real Screenshot Entry

For each page, `DesignSceneCanvas` provides a real screenshot/preview entry:

- done page with available preview opens current preview URL,
- pending page hides or disables the entry,
- expired page opens the last exported expired snapshot and marks it as expired,
- missing preview shows integrity issue using `PREVIEW_NOT_EXPORTED` details.

Opening preview must not re-export, mutate `.pen`, or change page status.

## Unsupported Properties

Scene payload `unsupported_properties` must be visible in UI.

Unsupported categories include:

- component ref expansion gaps,
- auto layout/flex/constraints,
- transform matrix,
- rotation/scale where unsupported,
- clip/mask/overflow,
- image fill mode/crop,
- gradient/shadow/blur/blend,
- font loading/line wrapping/text clipping,
- Pencil defaults and unknown properties.

When scene rendering differs from Pencil preview, UI classifies the difference:

- `scene_unsupported_property`,
- `preview_expired`,
- `preview_export_failed`,
- `possible_renderer_bug`.

Unsupported-property differences do not change design status.

## Accessibility

Canvas controls are keyboard-accessible buttons or menu items:

- pan,
- zoom,
- fit page,
- fit selection,
- 100% zoom,
- reset,
- open real screenshot,
- page location,
- clear selection.

Keyboard operations:

- arrow keys pan 48px,
- `Shift + arrow` pans 240px,
- `+` and `-` zoom one step,
- `0` returns to 100%,
- `F` fits current page or selection,
- `Esc` clears selection.

Canvas container exposes an accessible application region and `aria-describedby` for page, zoom, selected node count, and renderer warning summary.
Icon-only controls have localized `aria-label` and tooltip.

Page frame list and node list provide non-canvas alternatives. List selection syncs with canvas and PropertyPanel.

## Responsive Layout

For width below 768px:

- single-column DesignView,
- top page selector and session state,
- canvas minimum height 360px,
- PropertyPanel, quality report, and screenshot entry below,
- canvas controls wrap into two toolbar rows,
- button labels and status text do not overflow.

For width 768px and above:

- two-column canvas and PropertyPanel,
- PropertyPanel min width 320px,
- canvas min width 480px,
- page list, quality report, and lock status do not overlay interaction layer.

## i18n

All new UI strings go into `packages/web/src/i18n.ts` `en` and `zh` maps and are read with `useT()`.

Applies to:

- `DesignSceneCanvas`,
- `DesignView`,
- `PropertyPanel`,
- session status components,
- graph canvas controls,
- tooltips,
- aria labels,
- quality report labels.

API error codes remain English technical literals but are not the only user-facing explanation.

## Remove AnnotationCanvas Runtime Entry

Production runtime code must stop importing old `AnnotationCanvas`.

Reusable spacing types, spacing calculations, or Leafer test helpers move into one of:

- `DesignSceneCanvas.tsx`,
- a scene utility module,
- test fixtures.

They must not keep screenshot overlay as production design inspection.

## Failure Handling

- Scene load blocked by missing/incomplete/recovery-required index shows corresponding state and does not trigger writes during render.
- Renderer unsupported property warns instead of hiding the issue.
- Renderer bug classification applies only when supported basic rendering or hit testing is wrong.
- Preview missing shows integrity warning and does not regenerate preview.

## Out Of Scope

- Core scene payload generation belongs to spec 07.
- Server route data belongs to spec 10.
- Agent behavior belongs to spec 09.

## Acceptance Criteria

- Design page main interaction uses scene payload and Pencil `node_id`, not screenshot overlay.
- Canvas supports pan, zoom, fit page, fit selection, reset, 100% zoom, hover, click, and box selection.
- PropertyPanel displays structured node and component information.
- Real screenshot entry opens Pencil-exported preview without mutation.
- Unsupported properties are visible.
- Navigation graph supports infinite canvas interactions.
- Canvas and graph interactions have keyboard alternatives.
- Mobile and desktop layouts do not overlap controls, panels, status, and canvas.
- New UI strings are localized through `useT()`.
- Production `AnnotationCanvas` runtime path is removed.

## Verification

- Web component tests cover scene rendering, node hit testing, selection sync, PropertyPanel content, and export link.
- Interaction tests cover pan, zoom, fit page, fit selection, reset, 100% zoom, keyboard shortcuts, and box selection.
- Accessibility tests cover aria labels, tooltips, application region description, and list alternatives.
- Responsive tests cover below 768px and above 768px layouts.
- i18n tests assert no hardcoded new UI text in updated components.
- Route/UI tests confirm old screenshot overlay is not imported in production design view.
