import { describe, expect, it } from "vitest";
import { preprocessTailwindCSS } from "../src/tailwind-preprocessor.js";

describe("preprocessTailwindCSS", () => {
  it("parses pretty-printed nested tailwind.config objects before compiling utilities", async () => {
    const result = await preprocessTailwindCSS(`<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            brand: '#123456'
          }
        }
      }
    }
  </script>
</head>
<body>
  <div class="bg-brand text-white">Brand panel</div>
</body>
</html>`);

    expect(result.hasTailwind).toBe(true);
    expect(result.generatedCSS).toContain(".bg-brand");
    expect(result.generatedCSS).toContain("rgb(18 52 86");
    expect(result.html).not.toContain("cdn.tailwindcss.com");
  });
});
