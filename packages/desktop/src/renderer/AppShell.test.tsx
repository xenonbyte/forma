// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Stub the viewer so WorkspacePane mounts without @xyflow.
vi.mock("@xenonbyte/forma-viewer", () => ({
  buildViewerModel: (input: unknown) => ({ __model: input }),
  Viewer: () => createElement("div", { "data-testid": "viewer" }),
}));
vi.mock("./viewer/resolver.js", () => ({
  createDesktopResourceResolver: () => ({ resolve: () => "" }),
}));

import { AppShell } from "./AppShell.js";

function render(ui: React.ReactElement): { container: HTMLElement } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    createRoot(container).render(ui);
  });
  return { container };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

function installForma() {
  const listProducts = vi.fn().mockResolvedValue({
    products: [{ id: "p1", name: "产品一", description: "", platform: "web" }],
  });
  const getProduct = vi.fn().mockResolvedValue({ id: "p1", name: "产品一", description: "", platform: "web" });
  const listRequirements = vi.fn().mockResolvedValue({
    requirements: [
      // intentionally NO pages here — page-nav must come from getRequirement
      { id: "r1", title: "登录需求", status: "active", ui_affected: true },
    ],
  });
  const getRequirement = vi.fn().mockResolvedValue({
    id: "r1",
    title: "登录需求",
    status: "active",
    ui_affected: true,
    pages: [
      { page_id: "login", name: "登录页" },
      { page_id: "home", name: "首页" },
    ],
  });
  const listArtifacts = vi.fn().mockResolvedValue({ artifacts: [] });
  const formaServerBaseUrl = vi.fn().mockResolvedValue("http://127.0.0.1:3000");
  window.forma = {
    listProducts,
    getProduct,
    listRequirements,
    getRequirement,
    listArtifacts,
    formaServerBaseUrl,
  } as unknown as Window["forma"];
  return {
    listProducts,
    getProduct,
    getRequirement,
    listArtifacts,
    listRequirements,
    formaServerBaseUrl,
  };
}

beforeEach(() => {
  document.body.innerHTML = "";
  delete window.forma;
  window.location.hash = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("loads products and renders sidebar nav from getRequirement pages (not the listRequirements summary)", async () => {
    const { listProducts, getRequirement } = installForma();
    const { container } = render(<AppShell />);
    await flush();
    await flush();

    expect(listProducts).toHaveBeenCalled();
    // default requirement selected -> getRequirement called for full pages
    expect(getRequirement).toHaveBeenCalledWith("p1", "r1");

    // page-nav from getRequirement pages
    expect(container.querySelector('[data-nav-page="login"]')).not.toBeNull();
    expect(container.querySelector('[data-nav-page="home"]')).not.toBeNull();
  });

  it("restores requirement deep-link from hash — shows deep-linked req, not the first one", async () => {
    const { listRequirements } = installForma();
    // Override listRequirements to return r1 first, then r3 second
    listRequirements.mockResolvedValue({
      requirements: [
        { id: "r1", title: "第一需求", status: "active", ui_affected: true },
        { id: "r3", title: "第三需求", status: "active", ui_affected: true },
      ],
    });
    window.location.hash = "#/products/p1/requirements/r3";
    const { container } = render(<AppShell />);
    await flush();
    await flush();

    // The active nav item should be r3, not r1
    const activeItem = container.querySelector(".sidebar__item--active");
    expect(activeItem).not.toBeNull();
    expect(activeItem!.getAttribute("data-nav-requirement")).toBe("r3");

    // cleanup
    window.location.hash = "";
  });

  it("syncs workspace selection when the location hash changes after startup", async () => {
    const { listProducts, listRequirements } = installForma();
    listProducts.mockResolvedValue({
      products: [
        { id: "p1", name: "产品一", description: "", platform: "web" },
        { id: "p2", name: "产品二", description: "", platform: "web" },
      ],
    });
    listRequirements.mockImplementation(async (productId: string) => ({
      requirements:
        productId === "p2"
          ? [{ id: "r2", title: "第二产品需求", status: "active", ui_affected: true }]
          : [{ id: "r1", title: "第一产品需求", status: "active", ui_affected: true }],
    }));

    const { container } = render(<AppShell />);
    await flush();
    await flush();

    expect(
      required(container.querySelector<HTMLSelectElement>("[data-product-switcher]"), "product switcher").value,
    ).toBe("p1");

    await act(async () => {
      window.location.hash = "#/products/p2/requirements/r2";
      window.dispatchEvent(new Event("hashchange"));
    });
    await flush();
    await flush();

    expect(
      required(container.querySelector<HTMLSelectElement>("[data-product-switcher]"), "product switcher").value,
    ).toBe("p2");
    expect(container.querySelector('[data-nav-requirement="r1"]')).toBeNull();
    expect(container.querySelector('[data-nav-requirement="r2"]')).not.toBeNull();
    expect(container.querySelector(".sidebar__item--active")?.getAttribute("data-nav-requirement")).toBe("r2");
  });

  it("clears stale pages while switching requirements in the same product", async () => {
    const { listRequirements, getRequirement } = installForma();
    const r2Requirement = deferred<{
      id: string;
      title: string;
      status: string;
      ui_affected: boolean;
      pages: Array<{ page_id: string; name: string }>;
    }>();
    listRequirements.mockResolvedValue({
      requirements: [
        { id: "r1", title: "登录需求", status: "active", ui_affected: true },
        { id: "r2", title: "结算需求", status: "active", ui_affected: true },
      ],
    });
    getRequirement.mockImplementation(async (_productId: string, requirementId: string) => {
      if (requirementId === "r2") return r2Requirement.promise;
      return {
        id: "r1",
        title: "登录需求",
        status: "active",
        ui_affected: true,
        pages: [
          { page_id: "login", name: "登录页" },
          { page_id: "home", name: "首页" },
        ],
      };
    });

    const { container } = render(<AppShell />);
    await flush();
    await flush();

    expect(container.querySelector('[data-nav-page="login"]')).not.toBeNull();

    await act(async () => {
      required(container.querySelector<HTMLButtonElement>('[data-nav-requirement="r2"]'), "r2 requirement").click();
    });

    expect(container.querySelector('[data-nav-page="login"]')).toBeNull();
    expect(container.querySelector('[data-nav-page="home"]')).toBeNull();
    expect(container.textContent).toContain("选择需求以查看页面");

    await act(async () => {
      r2Requirement.resolve({
        id: "r2",
        title: "结算需求",
        status: "active",
        ui_affected: true,
        pages: [{ page_id: "checkout", name: "结算页" }],
      });
      await r2Requirement.promise;
    });
    await flush();

    expect(container.querySelector('[data-nav-page="checkout"]')).not.toBeNull();
  });

  it("downgrades an expired page hash to the requirement when the page is missing", async () => {
    installForma();
    window.location.hash = "#/products/p1/requirements/r1/pages/missing";

    const { container } = render(<AppShell />);
    await flush();
    await flush();

    const activeItem = container.querySelector(".sidebar__item--active");
    expect(activeItem).not.toBeNull();
    expect(activeItem!.getAttribute("data-nav-requirement")).toBe("r1");
    expect(activeItem!.getAttribute("data-nav-page")).toBeNull();
    expect(window.location.hash).toBe("#/products/p1/requirements/r1");
  });

  it("clears stale requirements while switching products and keeps them empty when loading fails", async () => {
    const { listProducts, listRequirements } = installForma();
    const p2Requirements = deferred<{
      requirements: Array<{ id: string; title: string; status: string; ui_affected: boolean }>;
    }>();
    listProducts.mockResolvedValue({
      products: [
        { id: "p1", name: "产品一", description: "", platform: "web" },
        { id: "p2", name: "产品二", description: "", platform: "web" },
      ],
    });
    listRequirements.mockImplementation((productId: string) => {
      if (productId === "p2") return p2Requirements.promise;
      return Promise.resolve({
        requirements: [{ id: "r1", title: "第一产品需求", status: "active", ui_affected: true }],
      });
    });

    const { container } = render(<AppShell />);
    await flush();
    await flush();

    expect(container.querySelector('[data-nav-requirement="r1"]')).not.toBeNull();

    await act(async () => {
      setSelectValue(
        required(container.querySelector<HTMLSelectElement>("[data-product-switcher]"), "product switcher"),
        "p2",
      );
    });

    expect(container.querySelector('[data-nav-requirement="r1"]')).toBeNull();
    expect(container.textContent).toContain("暂无需求");

    await act(async () => {
      p2Requirements.reject(new Error("load failed"));
      await p2Requirements.promise.catch(() => undefined);
    });
    await flush();

    expect(container.querySelector('[data-nav-requirement="r1"]')).toBeNull();
    expect(container.textContent).toContain("暂无需求");
  });

  it("clears a stale requirement hash after switching to a product with no requirements", async () => {
    const { listProducts, listRequirements } = installForma();
    listProducts.mockResolvedValue({
      products: [
        { id: "p1", name: "产品一", description: "", platform: "web" },
        { id: "p2", name: "产品二", description: "", platform: "web" },
      ],
    });
    listRequirements.mockImplementation(async (productId: string) => ({
      requirements:
        productId === "p2" ? [] : [{ id: "r1", title: "第一产品需求", status: "active", ui_affected: true }],
    }));
    window.location.hash = "#/products/p1/requirements/r1";

    const { container } = render(<AppShell />);
    await flush();
    await flush();

    expect(window.location.hash).toBe("#/products/p1/requirements/r1");

    await act(async () => {
      setSelectValue(
        required(container.querySelector<HTMLSelectElement>("[data-product-switcher]"), "product switcher"),
        "p2",
      );
    });
    await flush();
    await flush();

    expect(container.querySelector('[data-nav-requirement="r1"]')).toBeNull();
    expect(container.textContent).toContain("暂无需求");
    expect(window.location.hash).toBe("#/");
  });

  it("renders empty state when listProducts returns an empty list", async () => {
    const { listProducts } = installForma();
    listProducts.mockResolvedValue({ products: [] });
    const { container } = render(<AppShell />);
    await flush();
    await flush();

    // Should render the empty workspace prompt without crashing
    expect(container.querySelector(".workspace__empty")).not.toBeNull();
  });

  it("ignores a retained product hash when the product list is empty", async () => {
    const { listProducts, getProduct, getRequirement, listArtifacts } = installForma();
    listProducts.mockResolvedValue({ products: [] });
    window.location.hash = "#/products/deleted/requirements/r1/pages/login";

    const { container } = render(<AppShell />);
    await flush();
    await flush();

    expect(container.querySelector(".workspace__empty")).not.toBeNull();
    expect(getProduct).not.toHaveBeenCalled();
    expect(getRequirement).not.toHaveBeenCalled();
    expect(listArtifacts).not.toHaveBeenCalled();
  });

  it("sets connected to false when a startup IPC call rejects", async () => {
    const { listProducts } = installForma();
    listProducts.mockRejectedValue(new Error("IPC error"));
    const { container } = render(<AppShell />);
    await flush();

    // connected=false is surfaced via the sidebar connection dot going off
    const dot = container.querySelector(".sidebar__dot--off");
    expect(dot).not.toBeNull();
  });
});

function required<T extends Element>(element: T | null, label: string): T {
  if (!element) {
    throw new Error(`Missing ${label}`);
  }
  return element;
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}
