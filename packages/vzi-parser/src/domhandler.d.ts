declare module 'domhandler' {
  export interface AnyNode {
    type?: string;
    parent?: AnyNode | null;
    prev?: AnyNode | null;
    next?: AnyNode | null;
    startIndex?: number | null;
    endIndex?: number | null;
    [key: string]: unknown;
  }

  export interface ParentNode extends AnyNode {
    children?: AnyNode[];
  }

  export type Document = ParentNode;

  export interface Element extends ParentNode {
    name?: string;
    tagName?: string;
    attribs?: Record<string, string>;
  }
}
