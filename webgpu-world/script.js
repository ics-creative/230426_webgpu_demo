import {Camera} from "../libs/webgpu/Camera.js";
import {RoundCameraController} from '../libs/webgpu/RoundCameraController.js';
import {SceneObject} from '../libs/webgpu/SceneObject.js';
import {
  GPUBlendFactor,
  GPUBlendOperation,
  GPUBufferBindingType,
  GPUCompareFunction,
  GPUCullMode,
  GPUFrontFace,
  GPUIndexFormat,
  GPULoadOp,
  GPUPrimitiveTopology,
  GPUStoreOp,
  GPUTextureDimension,
  GPUTextureFormat,
  GPUVertexFormat,
  GPUVertexStepMode
} from "../libs/webgpu/GPUEnum.js";
import {GLTFLoader} from "./GLTFLoader.js";
import {GUI} from "../libs/third_party/lil.gui.esm.js"
import {Primitive, PrimitiveAttribute} from "../libs/webgpu/primitive/Primitive.js";
import {Color} from "../libs/webgpu/Color.js";

const RAD = Math.PI / 180;
const MAX_NUM = 20000;
const COLOR_AMBIENT_LIGHT = vec4.fromValues(0.2, 0.2, 0.2, 1.0);
const COLOR_DIRECTIONAL_LIGHT = vec4.fromValues(0.8, 0.8, 0.8, 1.0);

async function init() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice({});

  const canvas = document.getElementById('myCanvas');
  canvas.width = canvas.style.width = innerWidth;
  canvas.height = canvas.style.height = innerHeight;
  const context = canvas.getContext('webgpu');

  if (!adapter || !device || !context) {
    notSupportedDescription.style.display = "block";
    canvas.style.display = "none";
    return;
  }
  notSupportedDescription.style.display = "none";
  canvas.style.display = "inline";

  const stats = new Stats();
  document.body.appendChild(stats.dom);

  const swapChainFormat = navigator.gpu.getPreferredCanvasFormat();

  const swapChain = context.configure({
    device: device,
    format: swapChainFormat,
  });

  // language=WGSL
  const vertexShaderWGSL = `
  struct VariableInstanceUniforms {
    mMatrix : mat4x4<f32>
  };
  struct FixedInstanceUniforms {
    color : vec4<f32>
  };
  struct CommonUniforms {
    vpMatrix : mat4x4<f32>,
    ambientLightColor : vec4<f32>,
    directionalLightColor : vec4<f32>,
    directionalLightDirection : vec3<f32>
  };
  @binding(0) @group(0) var<uniform> variableInstanceUniforms : VariableInstanceUniforms;
  @binding(1) @group(0) var<uniform> fixedInstanceUniforms : FixedInstanceUniforms;
  @binding(0) @group(1) var<uniform> commonUniforms : CommonUniforms;

  struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) vColor : vec4<f32>
  };

  fn inverse3x3(m33:mat3x3<f32>) -> mat3x3<f32> {
    var inv0:vec3<f32> = vec3<f32>(
      m33[1][1]*m33[2][2] - m33[2][1]*m33[1][2],
      m33[2][1]*m33[0][2] - m33[0][1]*m33[2][2],
      m33[0][1]*m33[1][2] - m33[1][1]*m33[0][2],
    );
    var inv1:vec3<f32> = vec3<f32>(
      m33[2][0]*m33[1][2] - m33[1][0]*m33[2][2],
      m33[0][0]*m33[2][2] - m33[2][0]*m33[0][2],
      m33[1][0]*m33[0][2] - m33[0][0]*m33[1][2],
    );
    var inv2:vec3<f32> = vec3<f32>(
      m33[1][0]*m33[2][1] - m33[2][0]*m33[1][1],
      m33[2][0]*m33[0][1] - m33[0][0]*m33[2][1],
      m33[0][0]*m33[1][1] - m33[1][0]*m33[0][1],
    );
    return (1.0 / determinant(m33)) * mat3x3<f32>(inv0, inv1, inv2);
  }

  @vertex
  fn main(
    @location(0) position : vec3<f32>,
    @location(1) normal : vec3<f32>
  ) -> VertexOutput {
    var output : VertexOutput;
    // output.vColor = vec4<f32>((normal + vec3<f32>(1.0, 1.0, 1.0)) * 0.5, 1.0);
    // output.vColor = fixedInstanceUniforms.color;

    // var nMatrix:mat3x3<f32> = mat3x3<f32>(variableInstanceUniforms.mMatrix);
    var nMatrix:mat3x3<f32> = mat3x3<f32>(
      variableInstanceUniforms.mMatrix[0].xyz,
      variableInstanceUniforms.mMatrix[1].xyz,
      variableInstanceUniforms.mMatrix[2].xyz
    );
    nMatrix = inverse3x3(nMatrix);
    var worldNormal:vec3<f32> = normalize(normalize(normal) * nMatrix);// transpose
    var diffuse:f32 = dot(worldNormal, normalize(commonUniforms.directionalLightDirection));
    diffuse = clamp(diffuse, 0.0, 1.0);
    output.vColor = fixedInstanceUniforms.color * (commonUniforms.ambientLightColor + diffuse * commonUniforms.directionalLightColor);

    output.position = commonUniforms.vpMatrix * variableInstanceUniforms.mMatrix * vec4<f32>(position, 1.0);
    return output;
  }
  `;
  const gpuVertexState = {
    module: device.createShaderModule({code: vertexShaderWGSL}),
    entryPoint: "main"
  }
  if (gpuVertexState.module.compilationInfo) {
    console.log(await gpuVertexState.module.compilationInfo());
  }

  // language=WGSL
  const fragmentShaderWGSL = `
  @fragment
  fn main(
    @location(0) vColor: vec4<f32>,
  ) -> @location(0) vec4<f32> {
    return vColor;
  }
  `;
  const gpuFragmentState = {
    module: device.createShaderModule({code: fragmentShaderWGSL}),
    entryPoint: "main"
  }
  if (gpuVertexState.module.compilationInfo) {
    console.log(await gpuFragmentState.module.compilationInfo());
  }

  const gltfData = await GLTFLoader.load('assets/Suzanne.gltf');
  console.log(gltfData);

  const positionData = gltfData.position.data;
  const positionVerticesBuffer = device.createBuffer({
    size: positionData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(positionVerticesBuffer, 0, positionData.buffer, positionData.byteOffset, positionData.byteLength);

  const normalData = gltfData.normal.data;
  const normalVerticesBuffer = device.createBuffer({
    size: normalData.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(normalVerticesBuffer, 0, normalData.buffer, normalData.byteOffset, normalData.byteLength);

  let indexData = gltfData.indices.data;
  const needOffset = indexData.byteLength % 4;
  if (needOffset) {
    const newData = new Uint16Array(indexData.length + 1);
    newData.set(indexData, 0);
    gltfData.indices.data = newData;
    indexData = newData;
  }

  const indexBuffer = device.createBuffer({
    size: indexData.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(indexBuffer, 0, indexData.buffer, indexData.byteOffset, indexData.byteLength);

  const instanceUniformsBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX,
        buffer: {
          type: GPUBufferBindingType.uniform
        }
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX,
        buffer: {
          type: GPUBufferBindingType.uniform
        }
      }
    ]
  });
  const commonUniformsBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        type: GPUBufferBindingType.uniform
      }
    }]
  });

  const gpuRenderPipelineDescriptor = {
    layout: device.createPipelineLayout({bindGroupLayouts: [instanceUniformsBindGroupLayout, commonUniformsBindGroupLayout]}),

    vertex: Object.assign(gpuVertexState, {
      buffers: [
        {
          arrayStride: gltfData.position.num * 4,
          stepMode: GPUVertexStepMode.vertex,
          attributes: [{
            // position
            shaderLocation: 0,
            offset: 0,
            format: GPUVertexFormat.float32x3
          }]
        },
        {
          arrayStride: gltfData.position.num * 4,
          stepMode: GPUVertexStepMode.vertex,
          attributes: [{
            // normal
            shaderLocation: 1,
            offset: 0,
            format: GPUVertexFormat.float32x3
          }]
        }
      ]
    }),

    fragment: Object.assign(gpuFragmentState, {
      targets: [{
        format: swapChainFormat,
        blend: {
          color: {
            srcFactor: GPUBlendFactor.one,
            dstFactor: GPUBlendFactor.zero,
            operation: GPUBlendOperation.add
          },
          alpha: {
            srcFactor: GPUBlendFactor.one,
            dstFactor: GPUBlendFactor.zero,
            operation: GPUBlendOperation.add
          }
        },
        writeMask: GPUColorWrite.ALL
      }]
    }),

    primitive: {
      topology: GPUPrimitiveTopology.triangle_list,
      frontFace: GPUFrontFace.ccw,
      cullMode: GPUCullMode.back
    },

    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: GPUCompareFunction.less_equal,
      format: GPUTextureFormat.depth24plus
    }
  };

  const pipeline = device.createRenderPipeline(gpuRenderPipelineDescriptor);

  const createDepthTexture = () => device.createTexture({
    size: {
      width: canvas.width,
      height: canvas.height,
      depthOrArrayLayers: 1
    },
    mipLevelCount: 1,
    sampleCount: 1,
    dimension: GPUTextureDimension.texture_2d,
    format: GPUTextureFormat.depth24plus,
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });

  let depthTexture = createDepthTexture();
  const renderPassDescriptor = {
    colorAttachments: [{
      clearValue: {r: 0.3, g: 0.6, b: 0.8, a: 1.0},
      loadOp: GPULoadOp.clear,
      storeOp: GPUStoreOp.store,
      view: undefined,
    }],
    depthStencilAttachment: {
      view: depthTexture.createView(),
      depthClearValue: 1.0,
      depthLoadOp: GPULoadOp.clear,
      depthStoreOp: GPUStoreOp.store,
    }
  };

  const createOffsetUniform = (floatElementsPerObj, num) => {
    // Buffer offset for bind group needs to be 256-byte aligned
    const BUFFER_ALIGNMENT = 256;
    const FLOAT_ELEMENTS_ALIGNMENT = BUFFER_ALIGNMENT / Float32Array.BYTES_PER_ELEMENT;

    const alignedFloatElementsPerObj = Math.ceil(floatElementsPerObj / FLOAT_ELEMENTS_ALIGNMENT) * FLOAT_ELEMENTS_ALIGNMENT;
    const bufferSizePerObj = alignedFloatElementsPerObj * Float32Array.BYTES_PER_ELEMENT;
    const bufferByteSize = bufferSizePerObj * num;
    const bufferData = new Float32Array(alignedFloatElementsPerObj * num);
    return {alignedFloatElementsPerObj, bufferSizePerObj, bufferByteSize, bufferData};
  };

  const variableInstanceUniform = createOffsetUniform(16, MAX_NUM); // 4x4 matrix
  const variableInstanceUniformBuffer = device.createBuffer({
    size: variableInstanceUniform.bufferByteSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const fixedInstanceUniform = createOffsetUniform(4, MAX_NUM); // vec4
  const fixedInstanceUniformBuffer = device.createBuffer({
    size: fixedInstanceUniform.bufferByteSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const instanceUniformBindGroupList = [];
  for (let i = 0; i < MAX_NUM; i++) {
    instanceUniformBindGroupList[i] = device.createBindGroup({
      layout: instanceUniformsBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: variableInstanceUniformBuffer,
            offset: i * variableInstanceUniform.bufferSizePerObj,
            size: variableInstanceUniform.bufferSizePerObj,
          }
        },
        {
          binding: 1,
          resource: {
            buffer: fixedInstanceUniformBuffer,
            offset: i * fixedInstanceUniform.bufferSizePerObj,
            size: fixedInstanceUniform.bufferSizePerObj,
          }
        }
      ]
    });
  }

  const numUniformElements = Math.ceil((16 + 4 + 4 + 3) / 4) * 4;
  const commonUniformBufferData = new Float32Array(numUniformElements);
  const commonUniformBuffer = device.createBuffer({
    size: commonUniformBufferData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const commonUniformBindGroup = device.createBindGroup({
    layout: commonUniformsBindGroupLayout,
    entries: [{
      binding: 0,
      resource: {
        buffer: commonUniformBuffer,
        offset: 0,
        size: commonUniformBufferData.byteLength,
      }
    }]
  });
  commonUniformBufferData.set(COLOR_AMBIENT_LIGHT, 16);
  commonUniformBufferData.set(COLOR_DIRECTIONAL_LIGHT, 16 + 4);

  const camera = new Camera(45 * RAD, canvas.width / canvas.height, 0.1, 1000.0);
  const cameraController = new RoundCameraController(camera, canvas);
  canvas.style.cursor = 'move';
  const isIPhone = /iP(hone|(o|a)d)/.test(navigator.userAgent);
  cameraController.radius = isIPhone ? 250 : 150;
  cameraController.radiusOffset = 2;
  cameraController.rotate(0, 0);

  const cubeRange = 100;
  let objList;
  const resetInstance = () => {
    objList = [];
    for (let i = 0; i < num; i++) {
      const obj = new SceneObject();
      obj.scaleX = obj.scaleY = obj.scaleZ = 4.0;
      obj.x = (Math.random() - 0.5) * cubeRange;
      obj.y = (Math.random() - 0.5) * cubeRange;
      obj.z = (Math.random() - 0.5) * cubeRange;
      obj.rotationZ = Math.random() * 360 * RAD;
      objList[i] = obj;

      const color = Color.createRGBFromHSV(Math.atan2(obj.z, obj.x) / RAD, 0.8 * Math.sqrt(obj.x * obj.x + obj.z * obj.z) / (cubeRange / 2), 0.9);
      fixedInstanceUniform.bufferData.set(color, fixedInstanceUniform.alignedFloatElementsPerObj * i);
      variableInstanceUniform.bufferData.set(obj.getModelMatrix(), variableInstanceUniform.alignedFloatElementsPerObj * i);
    }
    device.queue.writeBuffer(fixedInstanceUniformBuffer, 0, fixedInstanceUniform.bufferData.buffer, 0, fixedInstanceUniform.bufferSizePerObj * num);
    device.queue.writeBuffer(variableInstanceUniformBuffer, 0, variableInstanceUniform.bufferData.buffer, 0, variableInstanceUniform.bufferSizePerObj * num);
  };

  const lightHelper = await createLightHelperPass(device, swapChainFormat);
  lightHelper.transform.scaleX = lightHelper.transform.scaleY = lightHelper.transform.scaleZ = 4.0;
  lightHelper.uniform.bufferData.set([0.8, 0.8, 0.8, 1.0], 32);

  const setting = {
    num: 1000,
    update: true
  };
  let num = setting.num;
  const gui = new GUI();
  const numSlider = gui.add(setting, 'num', 100, MAX_NUM).step(100);
  numSlider.onFinishChange((value) => {
    num = value;
    resetInstance();
  });
  gui.add(setting, 'update', setting.update);
  resetInstance();

  const onResize = () => {
    camera.aspect = innerWidth / innerHeight;
    canvas.width = canvas.style.width = innerWidth;
    canvas.height = canvas.style.height = innerHeight;
    depthTexture.destroy();
    depthTexture = createDepthTexture();
    renderPassDescriptor.depthStencilAttachment.view = depthTexture.createView();
  }
  addEventListener("resize", onResize);

  let time = 0;
  let previousTimeStamp = performance.now();

  function frame() {
    stats.begin();
    //
    const timeStamp = performance.now();
    const timeElapsed = timeStamp - previousTimeStamp;
    previousTimeStamp = timeStamp;
    // 元コードが60FPSを前提としたアニメーション値だったので、実際の経過時間から（60FPS換算で）何フレーム分進んだかを計算
    const timeScale = timeElapsed * 60 / 1000;
    time += timeScale;

    cameraController.update(0.1);

    const rad = time / 100;
    const lightDirection = vec3.fromValues(Math.cos(rad), 0.4, Math.sin(rad));
    commonUniformBufferData.set(lightDirection, 16 + 4 + 4);

    lightHelper.transform.x = lightDirection[0] * 80;
    lightHelper.transform.y = lightDirection[1] * 80;
    lightHelper.transform.z = lightDirection[2] * 80;

    const vpMatrix = camera.getCameraMtx();
    commonUniformBufferData.set(vpMatrix, 0);
    device.queue.writeBuffer(commonUniformBuffer, 0, commonUniformBufferData.buffer);

    if (setting.update) {
      for (let i = 0; i < num; i++) {
        const obj = objList[i];
        if (((time + i * 7) / 50 << 0) % 10 === 0) {
          obj.rotationY += 0.2 * timeScale;
        } else {
          obj.rotationX += 0.01 * timeScale;
        }
        variableInstanceUniform.bufferData.set(obj.getModelMatrix(), variableInstanceUniform.alignedFloatElementsPerObj * i);
      }
      device.queue.writeBuffer(variableInstanceUniformBuffer, 0, variableInstanceUniform.bufferData.buffer, 0, variableInstanceUniform.bufferSizePerObj * num);
    }

    lightHelper.uniform.bufferData.set(vpMatrix, 0);
    lightHelper.uniform.bufferData.set(lightHelper.transform.getModelMatrix(), 16);
    device.queue.writeBuffer(lightHelper.uniform.buffer, 0, lightHelper.uniform.bufferData.buffer);

    const commandEncoder = device.createCommandEncoder({});
    renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
    passEncoder.setPipeline(pipeline);
    passEncoder.setVertexBuffer(0, positionVerticesBuffer, 0);
    passEncoder.setVertexBuffer(1, normalVerticesBuffer, 0);
    passEncoder.setIndexBuffer(indexBuffer, GPUIndexFormat.uint16, 0);
    passEncoder.setBindGroup(1, commonUniformBindGroup);

    for (let i = 0; i < num; i++) {
      passEncoder.setBindGroup(0, instanceUniformBindGroupList[i]);
      passEncoder.drawIndexed(gltfData.indices.length, 1, 0, 0, 0);
    }

    passEncoder.setPipeline(lightHelper.pipeline);
    passEncoder.setVertexBuffer(0, lightHelper.vertexBuffer, 0);
    passEncoder.setIndexBuffer(lightHelper.indexBuffer, GPUIndexFormat.uint32, 0);
    passEncoder.setBindGroup(0, lightHelper.uniform.bindGroup);
    passEncoder.drawIndexed(lightHelper.numIndices, 1, 0, 0, 0);

    passEncoder.end();

    device.queue.submit([commandEncoder.finish()]);

    requestAnimationFrame(frame);
    //
    stats.end();
  }

  requestAnimationFrame(frame);
}

async function createLightHelperPass(device, swapChainFormat) {
  // language=WGSL
  const vertexShaderWGSL = `
  struct Uniforms {
    vpMatrix : mat4x4<f32>,
    mMatrix : mat4x4<f32>,
    color : vec4<f32>
  };
  @binding(0) @group(0) var<uniform> uniforms : Uniforms;

  struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) vColor : vec4<f32>
  };

  @vertex
  fn main(
    @location(0) position : vec3<f32>
  ) -> VertexOutput {
    var output : VertexOutput;
    output.vColor = uniforms.color;
    output.position = uniforms.vpMatrix * uniforms.mMatrix * vec4<f32>(position, 1.0);
    return output;
  }
  `;
  const gpuVertexState = {
    module: device.createShaderModule({code: vertexShaderWGSL}),
    entryPoint: "main"
  }
  if (gpuVertexState.module.compilationInfo) {
    console.log(await gpuVertexState.module.compilationInfo());
  }

  // language=WGSL
  const fragmentShaderWGSL = `
  @fragment
  fn main(
    @location(0) vColor: vec4<f32>
  ) -> @location(0) vec4<f32> {
    return vColor;
  }
  `;
  const gpuFragmentState = {
    module: device.createShaderModule({code: fragmentShaderWGSL}),
    entryPoint: "main"
  }
  if (gpuVertexState.module.compilationInfo) {
    console.log(await gpuFragmentState.module.compilationInfo());
  }

  const uniformsBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        type: GPUBufferBindingType.uniform,
        hasDynamicOffset: false
      }
    }]
  });

  const uniformBufferData = new Float32Array(36);
  const uniformBuffer = device.createBuffer({
    size: uniformBufferData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const uniformBindGroup = device.createBindGroup({
    layout: uniformsBindGroupLayout,
    entries: [{
      binding: 0,
      resource: {
        buffer: uniformBuffer,
        offset: 0,
        size: uniformBufferData.byteLength,
      }
    }]
  });

  const vertexSize = Float32Array.BYTES_PER_ELEMENT * 3;
  const positionOffset = Float32Array.BYTES_PER_ELEMENT * 0;

  const gpuRenderPipelineDescriptor = {
    layout: device.createPipelineLayout({
      bindGroupLayouts: [uniformsBindGroupLayout]
    }),

    vertex: Object.assign(gpuVertexState, {
      buffers: [{
        arrayStride: vertexSize,
        stepMode: GPUVertexStepMode.vertex,
        attributes: [{
          // position
          shaderLocation: 0,
          offset: positionOffset,
          format: GPUVertexFormat.float32x3
        }]
      }]
    }),

    fragment: Object.assign(gpuFragmentState, {
      targets: [{
        format: swapChainFormat,
        blend: {
          color: {
            srcFactor: GPUBlendFactor.one,
            dstFactor: GPUBlendFactor.zero,
            operation: GPUBlendOperation.add
          },
          alpha: {
            srcFactor: GPUBlendFactor.one,
            dstFactor: GPUBlendFactor.zero,
            operation: GPUBlendOperation.add
          }
        },
        writeMask: GPUColorWrite.ALL
      }]
    }),

    primitive: {
      topology: GPUPrimitiveTopology.line_strip,
      stripIndexFormat: GPUIndexFormat.uint32,
      frontFace: GPUFrontFace.ccw,
      cullMode: GPUCullMode.back
    },

    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: GPUCompareFunction.less_equal,
      format: GPUTextureFormat.depth24plus
    }
  };
  const pipeline = device.createRenderPipeline(gpuRenderPipelineDescriptor);

  const primitive = Primitive.createSphere(0.5, 3, 3, [[PrimitiveAttribute.POSITION]]);
  const vertices = primitive.attributeBufferDataList[0];
  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertices.buffer);

  const indices = new Uint32Array(primitive.indexList);
  const numIndices = indices.length;
  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(indexBuffer, 0, indices.buffer);

  return {
    transform: new SceneObject(),
    uniform: {
      buffer: uniformBuffer,
      bufferData: uniformBufferData,
      bindGroup: uniformBindGroup,
    },
    pipeline,
    vertexBuffer,
    indexBuffer,
    numIndices
  };
}

window.addEventListener('DOMContentLoaded', init);
