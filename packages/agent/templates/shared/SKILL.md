# Forma shared guidance

Use Forma MCP tools for product, requirement, design, style, and rollback workflows.

Core rules:
- Read the current session before taking route-specific action.
- Fetch the latest requirement when the route needs requirement context.
- Construct a prompt from current product, current requirement, and route intent.
- Call Forma MCP tools rather than editing Forma data files directly.
- Report stable Forma error codes exactly as returned by the MCP server.
- Do not hide pending or expired design state from the user.
