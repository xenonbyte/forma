import { IRElementType } from './types';

const styleValueSchema = {
  anyOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }],
};

export const irElementSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    parentId: { type: ['string', 'null'] },
    type: { type: 'string', enum: Object.values(IRElementType) as IRElementType[] },
    bounds: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
      },
      required: ['x', 'y', 'width', 'height'],
      additionalProperties: false,
    },
    styles: {
      type: 'object',
      required: [],
      additionalProperties: styleValueSchema,
    },
    textContent: { type: ['string', 'null'] },
    source: {
      anyOf: [
        {
          type: 'object',
          properties: {
            tagName: { type: ['string', 'null'] },
            className: { type: ['string', 'null'] },
            id: { type: ['string', 'null'] },
            role: { type: ['string', 'null'] },
            name: { type: ['string', 'null'] },
            dataAttributes: {
              anyOf: [
                {
                  type: 'object',
                  required: [],
                  additionalProperties: { type: 'string' },
                },
                { type: 'null' },
              ],
            },
            ariaAttributes: {
              anyOf: [
                {
                  type: 'object',
                  required: [],
                  additionalProperties: { type: 'string' },
                },
                { type: 'null' },
              ],
            },
            // HTML元素核心属性
            src: { type: ['string', 'null'] },
            href: { type: ['string', 'null'] },
            alt: { type: ['string', 'null'] },
            target: { type: ['string', 'null'] },
            rel: { type: ['string', 'null'] },
            type: { type: ['string', 'null'] },
            placeholder: { type: ['string', 'null'] },
            value: { type: ['string', 'null'] },
          },
          required: [],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    pseudoElements: {
      anyOf: [
        {
          type: 'object',
          properties: {
            before: {
              anyOf: [
                {
                  type: 'object',
                  properties: {
                    content: { type: ['string', 'null'] },
                    styles: {
                      anyOf: [
                        {
                          type: 'object',
                          required: [],
                          additionalProperties: styleValueSchema,
                        },
                        { type: 'null' },
                      ],
                    },
                  },
                  required: [],
                  additionalProperties: false,
                },
                { type: 'null' },
              ],
            },
            after: {
              anyOf: [
                {
                  type: 'object',
                  properties: {
                    content: { type: ['string', 'null'] },
                    styles: {
                      anyOf: [
                        {
                          type: 'object',
                          required: [],
                          additionalProperties: styleValueSchema,
                        },
                        { type: 'null' },
                      ],
                    },
                  },
                  required: [],
                  additionalProperties: false,
                },
                { type: 'null' },
              ],
            },
          },
          required: [],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    responsive: {
      anyOf: [
        {
          type: 'object',
          properties: {
            breakpoints: {
              anyOf: [
                {
                  type: 'array',
                  items: { type: 'number' },
                },
                { type: 'null' },
              ],
            },
            mediaQueries: {
              anyOf: [
                {
                  type: 'array',
                  items: { type: 'string' },
                },
                { type: 'null' },
              ],
            },
          },
          required: [],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    animations: {
      anyOf: [
        {
          type: 'object',
          properties: {
            transitions: {
              anyOf: [
                {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      property: { type: 'string' },
                      duration: { type: 'string' },
                      timingFunction: { type: ['string', 'null'] },
                      delay: { type: ['string', 'null'] },
                    },
                    required: ['property', 'duration'],
                    additionalProperties: false,
                  },
                },
                { type: 'null' },
              ],
            },
            keyframes: {
              anyOf: [
                {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      steps: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            offset: { type: 'string' },
                            styles: {
                              type: 'object',
                              required: [],
                              additionalProperties: styleValueSchema,
                            },
                          },
                          required: ['offset', 'styles'],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ['name', 'steps'],
                    additionalProperties: false,
                  },
                },
                { type: 'null' },
              ],
            },
          },
          required: [],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    transform: {
      anyOf: [
        {
          type: 'object',
          properties: {
            matrix: {
              anyOf: [
                {
                  type: 'array',
                  items: { type: 'number' },
                },
                { type: 'null' },
              ],
            },
            translate: {
              anyOf: [
                {
                  type: 'object',
                  properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                    z: { type: ['number', 'null'] },
                  },
                  required: ['x', 'y'],
                  additionalProperties: false,
                },
                { type: 'null' },
              ],
            },
            rotate: {
              anyOf: [
                {
                  type: 'object',
                  properties: {
                    x: { type: ['number', 'null'] },
                    y: { type: ['number', 'null'] },
                    z: { type: ['number', 'null'] },
                  },
                  required: [],
                  additionalProperties: false,
                },
                { type: 'null' },
              ],
            },
            scale: {
              anyOf: [
                {
                  type: 'object',
                  properties: {
                    x: { type: 'number' },
                    y: { type: 'number' },
                    z: { type: ['number', 'null'] },
                  },
                  required: ['x', 'y'],
                  additionalProperties: false,
                },
                { type: 'null' },
              ],
            },
          },
          required: [],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    effects: {
      anyOf: [
        {
          type: 'object',
          properties: {
            filters: {
              anyOf: [
                {
                  type: 'array',
                  items: { type: 'string' },
                },
                { type: 'null' },
              ],
            },
            shadows: {
              anyOf: [
                {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      x: { type: 'number' },
                      y: { type: 'number' },
                      blur: { type: 'number' },
                      spread: { type: ['number', 'null'] },
                      color: { type: 'string' },
                      inset: { type: ['boolean', 'null'] },
                    },
                    required: ['x', 'y', 'blur', 'color'],
                    additionalProperties: false,
                  },
                },
                { type: 'null' },
              ],
            },
          },
          required: [],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    metadata: {
      anyOf: [
        {
          type: 'object',
          required: [],
          additionalProperties: true,
        },
        { type: 'null' },
      ],
    },
    svgData: {
      anyOf: [
        {
          type: 'object',
          properties: {
            viewBox: { type: ['string', 'null'] },
            preserveAspectRatio: { type: ['string', 'null'] },
            paths: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  d: { type: 'string' },
                  fill: { type: ['string', 'null'] },
                  stroke: { type: ['string', 'null'] },
                  strokeWidth: { type: ['number', 'null'] },
                  strokeDasharray: { type: ['string', 'null'] },
                  strokeDashoffset: { type: ['number', 'null'] },
                  strokeLinecap: { type: ['string', 'null'] },
                  fillRule: { type: 'string', enum: ['nonzero', 'evenodd'], nullable: false },
                  opacity: { type: ['number', 'null'] },
                },
                required: ['d'],
                additionalProperties: false,
              },
            },
            circles: {
              anyOf: [
                {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      cx: { type: 'number' },
                      cy: { type: 'number' },
                      r: { type: 'number' },
                      fill: { type: ['string', 'null'] },
                      stroke: { type: ['string', 'null'] },
                      strokeWidth: { type: ['number', 'null'] },
                      strokeDasharray: { type: ['string', 'null'] },
                      strokeDashoffset: { type: ['number', 'null'] },
                      strokeLinecap: { type: ['string', 'null'] },
                      opacity: { type: ['number', 'null'] },
                    },
                    required: ['cx', 'cy', 'r'],
                    additionalProperties: false,
                  },
                },
                { type: 'null' },
              ],
            },
            rects: {
              anyOf: [
                {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      x: { type: 'number' },
                      y: { type: 'number' },
                      width: { type: 'number' },
                      height: { type: 'number' },
                      rx: { type: ['number', 'null'] },
                      ry: { type: ['number', 'null'] },
                      fill: { type: ['string', 'null'] },
                      stroke: { type: ['string', 'null'] },
                      strokeWidth: { type: ['number', 'null'] },
                      opacity: { type: ['number', 'null'] },
                    },
                    required: ['x', 'y', 'width', 'height'],
                    additionalProperties: false,
                  },
                },
                { type: 'null' },
              ],
            },
            polygons: {
              anyOf: [
                {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      points: { type: 'string' },
                      fill: { type: ['string', 'null'] },
                      stroke: { type: ['string', 'null'] },
                      strokeWidth: { type: ['number', 'null'] },
                      opacity: { type: ['number', 'null'] },
                    },
                    required: ['points'],
                    additionalProperties: false,
                  },
                },
                { type: 'null' },
              ],
            },
          },
          required: ['paths'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
    imageData: {
      anyOf: [
        {
          type: 'object',
          properties: {
            src: { type: 'string' },
            naturalWidth: { type: 'number' },
            naturalHeight: { type: 'number' },
            format: {
              anyOf: [
                { type: 'string', enum: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'gif', 'bmp'] },
                { type: 'null' },
              ],
            },
            isBase64: { type: ['boolean', 'null'] },
            alt: { type: ['string', 'null'] },
          },
          required: ['src', 'naturalWidth', 'naturalHeight'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
  },
  required: ['id', 'parentId', 'type', 'bounds', 'styles'],
  additionalProperties: false,
};

export const irSchema = {
  type: 'object',
  properties: {
    version: { type: 'string' },
    rootElementId: { type: 'string' },
    elements: {
      type: 'object',
      required: [],
      additionalProperties: irElementSchema,
    },
    metadata: {
      anyOf: [
        {
          type: 'object',
          required: [],
          additionalProperties: true,
        },
        { type: 'null' },
      ],
    },
  },
  required: ['version', 'rootElementId', 'elements'],
  additionalProperties: false,
};
