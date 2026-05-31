/**
 * 右侧标注信息栏:本期仅预留 slot,不实现标注内容(由后续阶段填充)。
 */
export function AnnotationSlot(): React.ReactElement {
  return (
    <aside
      data-slot="annotation"
      aria-label="标注信息栏"
      style={{ height: "100%", padding: 12, color: "#888", fontSize: 12 }}
    >
      标注功能待后续版本提供。
    </aside>
  );
}
