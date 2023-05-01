export const GPUTextureDimension = {
  texture_1d: "1d",
  texture_2d: "2d",
  texture_3d: "3d"
};
export const GPUTextureViewDimension = {
  texture_1d: "1d",
  texture_2d: "2d",
  texture_2d_array: "2d-array",
  texture_cube: "cube",
  texture_cube_array: "cube-array",
  texture_3d: "3d"
};
export const GPUTextureAspect = {
  all: "all",
  stencil_only: "stencil-only",
  depth_only: "depth-only"
};
export const GPUTextureFormat = {
  r32float: "r32float",
  rgba8unorm: "rgba8unorm",
  bgra8unorm: "bgra8unorm",
  rgba16float: "rgba16float",
  depth24plus: "depth24plus",
  depth24plus_stencil8: "depth24plus-stencil8",
  depth32float: "depth32float"
};
export const GPUAddressMode = {
  clamp_to_edge: "clamp-to-edge",
  repeat: "repeat",
  mirror_repeat: "mirror-repeat"
};
export const GPUFilterMode = {
  nearest: "nearest",
  linear: "linear"
};
export const GPUCompareFunction = {
  never: "never",
  less: "less",
  equal: "equal",
  less_equal: "less-equal",
  greater: "greater",
  not_equal: "not-equal",
  greater_equal: "greater-equal",
  always: "always"
};
export const GPUBufferBindingType = {
  uniform: "uniform",
  storage: "storage",
  read_only_storage: "read-only-storage"
};
export const GPUSamplerBindingType = {
  filtering: "filtering",
  non_filtering: "non-filtering",
  comparison: "comparison"
};
export const GPUTextureSampleType = {
  float: "float",
  unfilterable_float: "unfilterable-float",
  depth: "depth",
  sint: "sint",
  uint: "uint",
};
export const GPUPrimitiveTopology = {
  point_list: "point-list",
  line_list: "line-list",
  line_strip: "line-strip",
  triangle_list: "triangle-list",
  triangle_strip: "triangle-strip"
};
export const GPUFrontFace = {
  ccw: "ccw",
  cw: "cw"
};
export const GPUCullMode = {
  none: "none",
  front: "front",
  back: "back"
};
export const GPUBlendFactor = {
  zero: "zero",
  one: "one",
  src_alpha: "src-alpha",
  one_minus_src_alpha: "one-minus-src-alpha"
};
export const GPUBlendOperation = {
  add: "add"
};
export const GPUIndexFormat = {
  uint16: "uint16",
  uint32: "uint32"
};
export const GPUVertexFormat = {
  uint8x2: "uint8x2",
  uint8x4: "uint8x4",
  sint8x2: "sint8x2",
  sint8x4: "sint8x4",
  unorm8x2: "unorm8x2",
  unorm8x4: "unorm8x4",
  snorm8x2: "snorm8x2",
  snorm8x4: "snorm8x4",
  uint16x2: "uint16x2",
  uint16x4: "uint16x4",
  sint16x2: "sint16x2",
  sint16x4: "sint16x4",
  unorm16x2: "unorm16x2",
  unorm16x4: "unorm16x4",
  snorm16x2: "snorm16x2",
  snorm16x4: "snorm16x4",
  float16x2: "float16x2",
  float16x4: "float16x4",
  float32: "float32",
  float32x2: "float32x2",
  float32x3: "float32x3",
  float32x4: "float32x4",
  uint32: "uint32",
  uint32x2: "uint32x2",
  uint32x3: "uint32x3",
  uint32x4: "uint32x4",
  sint32: "sint32",
  sint32x2: "sint32x2",
  sint32x3: "sint32x3",
  sint32x4: "sint32x4"
};
export const GPUVertexStepMode = {
  vertex: "vertex",
  instance: "instance"
};
export const GPULoadOp = {
  load: "load",
  clear: "clear"
};
export const GPUStoreOp = {
  store: "store",
  discard: "discard"
};



