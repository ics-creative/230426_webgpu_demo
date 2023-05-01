import {Camera} from "../libs/webgpu/Camera.js";
import {RoundCameraController} from "../libs/webgpu/RoundCameraController.js";
import {SceneObject} from "../libs/webgpu/SceneObject.js";
import {
  GPUBlendFactor,
  GPUBlendOperation,
  GPUBufferBindingType,
  GPUCompareFunction,
  GPUCullMode,
  GPUFilterMode,
  GPUFrontFace,
  GPUIndexFormat,
  GPULoadOp,
  GPUPrimitiveTopology,
  GPUSamplerBindingType,
  GPUStoreOp,
  GPUTextureDimension,
  GPUTextureFormat,
  GPUTextureSampleType,
  GPUTextureViewDimension,
  GPUVertexFormat,
  GPUVertexStepMode
} from "../libs/webgpu/GPUEnum.js";
import {Primitive, PrimitiveAttribute} from "../libs/webgpu/primitive/Primitive.js";
import {Color} from "../libs/webgpu/Color.js";
import {Ease24, Tween24} from "../libs/third_party/tween24.esm.js";
import {GUI} from "../libs/third_party/lil.gui.esm.js";

const RAD = Math.PI / 180;

const MOVEMENT_TYPE_WAVE = "wave";
const MOVEMENT_TYPE_SPIRAL = "spiral";
const MOVEMENT_TYPE_RANDOM = "random";
const MOVEMENT_TYPE_NONE = "none";
const MOVEMENT_LIST = [
  MOVEMENT_TYPE_WAVE,
  MOVEMENT_TYPE_SPIRAL,
  MOVEMENT_TYPE_RANDOM,
  MOVEMENT_TYPE_NONE
];

const MAX_LIGHT_NUM = 2000;

async function init() {
  const adapter = await navigator.gpu?.requestAdapter();
  const device = await adapter?.requestDevice({});

  const canvas = document.getElementById("myCanvas");
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  const context = canvas.getContext("webgpu");

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

  const renderPassDescriptorCanvas = {
    colorAttachments: [{
      clearValue: {r: 0.1, g: 0.1, b: 0.1, a: 1.0},
      loadOp: GPULoadOp.clear,
      storeOp: GPUStoreOp.store,
      view: undefined,
    }]
  };

  const renderTarget = await createRenderTarget(device, swapChainFormat, canvas.width, canvas.height);
  const renderScreenVertex = await createRenderScreenVertex(device);

  const commonUniforms = await createCommonUniforms(device);
  const resizeCommonUniform = (w, h) => {
    commonUniforms.bufferData[32] = w;
    commonUniforms.bufferData[33] = h;
    commonUniforms.bufferData[34] = 1.0 / w;
    commonUniforms.bufferData[35] = 1.0 / h;
  };
  resizeCommonUniform(canvas.width, canvas.height);

  const geometryPass = await createGeometryPass(device, swapChainFormat, canvas.width, canvas.height, renderTarget, commonUniforms);
  const ambientLightingPass = await createAmbientLightingPass(device, swapChainFormat, renderTarget, renderScreenVertex);
  const pointLightingPass = await createPointLightingPass(device, swapChainFormat, commonUniforms, renderTarget);
  const lightHelperPass = await createLightHelperPass(device, swapChainFormat, renderTarget.depthTexture, commonUniforms);
  const renderGBufferPass = await createRenderGBufferPass(device, swapChainFormat, renderTarget, commonUniforms, renderScreenVertex);

  const initialLightNum = 20;
  const setting = {
    lightNum: initialLightNum,
    displayLightNum: initialLightNum,
    isShowGBuffer: false,
    isShowLightHelper: false,
    movementType: MOVEMENT_TYPE_WAVE
  };

  const scene = await createScene(device, geometryPass.modelUniformsBindGroupLayout, pointLightingPass.pointLightUniformsBindGroupLayout, ambientLightingPass.ambientLightUniformsBindGroupLayout);
  const ambientLightColor = 0x333333;
  const ambientLightIntensity = 1.0;
  scene.ambientLight.bufferData.set([((ambientLightColor >> 16) & 0xFF) / 255, ((ambientLightColor >> 8) & 0xFF) / 255, (ambientLightColor & 0xFF) / 255, 1.0, ambientLightIntensity]);
  device.queue.writeBuffer(scene.ambientLight.buffer, 0, scene.ambientLight.bufferData.buffer);

  createPointLightList(setting.lightNum);

  const gui = new GUI();
  gui.add(setting, "isShowGBuffer", setting.isShowGBuffer).name("G-buffer").onFinishChange(value => {
    if (value) {
      lightFolder.hide();
    } else {
      lightFolder.show();
    }
  });
  const lightFolder = gui.addFolder("Light");
  lightFolder.add(setting, "displayLightNum", 1, MAX_LIGHT_NUM).step(1).name("Num").onFinishChange(value => {
    setting.lightNum = value;
    createPointLightList(value);
    if (setting.movementType === MOVEMENT_TYPE_RANDOM) {
      pointLightUpdateRandom();
    }
  });
  lightFolder.add(setting, "isShowLightHelper", setting.isShowLightHelper).name("Helper");
  lightFolder.add(setting, "movementType", MOVEMENT_LIST).name("Movement").onFinishChange(value => {
    if (value === MOVEMENT_TYPE_RANDOM) {
      pointLightUpdateRandom();
    } else {
      Tween24.stopByGroupId(MOVEMENT_TYPE_RANDOM);
    }
  });

  const camera = new Camera(45 * RAD, canvas.width / canvas.height, 0.1, 1000.0, true);
  const cameraController = new RoundCameraController(camera, canvas);
  canvas.style.cursor = "move";
  cameraController.radius = 10.0;
  cameraController.set(0, 60);

  const resize = () => {
    const w = innerWidth;
    const h = innerHeight;
    camera.aspect = w / h;
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";

    resizeCommonUniform(w, h);
    renderTarget.resize(w, h);
    geometryPass.renderPassDescriptor.colorAttachments[0].view = renderTarget.diffuseTexture.view;
    geometryPass.renderPassDescriptor.colorAttachments[1].view = renderTarget.normalTexture.view;
    geometryPass.renderPassDescriptor.depthStencilAttachment.view = renderTarget.depthTexture.view;
    renderTarget.uniformBindGroup = renderTarget.createUniformBindGroup();
    lightHelperPass.textureUniformsBindGroup = lightHelperPass.createTextureUniformsBindGroup(renderTarget.depthTexture);
  };

  let resizeTimer;
  const onResize = () => {
    if (resizeTimer) {
      clearTimeout(resizeTimer);
    }
    resizeTimer = setTimeout(resize, 200);
  }
  addEventListener("resize", onResize);

  let frameCount = 0;
  let previousTimeStamp = performance.now();
  const inverseVPMatrix = mat4.create();

  function frame() {
    stats.begin();
    //
    const timeStamp = performance.now();
    const timeElapsed = timeStamp - previousTimeStamp;
    previousTimeStamp = timeStamp;
    // 元コードが60FPSを前提としたアニメーション値だったので、実際の経過時間から（60FPS換算で）何フレーム分進んだかを計算
    frameCount += timeElapsed * 60 / 1000;
    cameraController.update(0.1);
    commonUniforms.bufferData.set(camera.getCameraMtx(), 0);
    mat4.invert(inverseVPMatrix, camera.getCameraMtx());
    commonUniforms.bufferData.set(inverseVPMatrix, 16);
    device.queue.writeBuffer(commonUniforms.buffer, 0, commonUniforms.bufferData.buffer);

    {
      const torus = scene.torus;
      for (let i = 0; i < torus.num; i++) {
        const transform = torus.transformList[i];
        const rotation = torus.rotationList[i];
        rotation.angle += rotation.speed;
        quat.setAxisAngle(transform.quaternion, rotation.axis, rotation.angle);
        transform.dirty = true;
        torus.uniform.bufferData.set(transform.getModelMatrix(), torus.uniform.dynamicElements * i);
      }
      device.queue.writeBuffer(torus.uniform.buffer, 0, torus.uniform.bufferData.buffer);
    }

    {
      // update light position
      switch (setting.movementType) {
        case MOVEMENT_TYPE_WAVE: {
          pointLightUpdateWave(frameCount);
          break;
        }
        case MOVEMENT_TYPE_SPIRAL: {
          pointLightUpdateSpiral(frameCount);
          break;
        }
        case MOVEMENT_TYPE_RANDOM:
        case MOVEMENT_TYPE_NONE:
        default: {
          break;
        }
      }

      const pointLight = scene.pointLight;
      const lightLength = pointLight.num;
      for (let i = 0; i < lightLength; i++) {
        const transform = pointLight.list[i].transform;
        const posX = transform.x;
        const posY = transform.y;
        const posZ = transform.z;
        const offset = pointLight.uniform.dynamicElements * i;
        pointLight.uniform.bufferData.set(transform.getModelMatrix(), offset);
        pointLight.uniform.bufferData.set([posX, posY, posZ], offset + 16 + 4);

        const helperTransform = pointLight.helper.list[i].transform;
        helperTransform.x = posX;
        helperTransform.y = posY;
        helperTransform.z = posZ;
        pointLight.helper.uniform.bufferData.set(helperTransform.getModelMatrix(), pointLight.helper.uniform.dynamicElements * i);
      }
      device.queue.writeBuffer(pointLight.uniform.buffer, 0, pointLight.uniform.bufferData.buffer, 0, pointLight.uniform.dynamicBufferSize * lightLength);
      device.queue.writeBuffer(pointLight.helper.uniform.buffer, 0, pointLight.helper.uniform.bufferData.buffer, 0, pointLight.helper.uniform.dynamicBufferSize * lightLength);
    }

    const commandEncoder = device.createCommandEncoder({});

    {
      const passEncoder = commandEncoder.beginRenderPass(geometryPass.renderPassDescriptor);
      passEncoder.setPipeline(geometryPass.pipeline);

      passEncoder.setBindGroup(0, commonUniforms.bindGroup);

      {
        const plane = scene.plane;
        passEncoder.setBindGroup(1, plane.uniform.bindGroup, [0]);
        passEncoder.setVertexBuffer(0, plane.vertexBuffer, 0);
        passEncoder.setIndexBuffer(plane.indexBuffer, GPUIndexFormat.uint32, 0);
        passEncoder.drawIndexed(plane.numIndices, 1, 0, 0, 0);
      }

      {
        const sphere = scene.sphere;
        passEncoder.setBindGroup(1, sphere.uniform.bindGroup, [0]);
        passEncoder.setVertexBuffer(0, sphere.vertexBuffer, 0);
        passEncoder.setIndexBuffer(sphere.indexBuffer, GPUIndexFormat.uint32, 0);
        passEncoder.drawIndexed(sphere.numIndices, 1, 0, 0, 0);
      }

      {
        const torus = scene.torus;
        passEncoder.setVertexBuffer(0, torus.vertexBuffer, 0);
        passEncoder.setIndexBuffer(torus.indexBuffer, GPUIndexFormat.uint32, 0);
        for (let i = 0; i < torus.num; i++) {
          passEncoder.setBindGroup(1, torus.uniform.bindGroup, [i * torus.uniform.dynamicBufferSize]);
          passEncoder.drawIndexed(torus.numIndices, 1, 0, 0, 0);
        }
      }

      passEncoder.end();
    }

    renderPassDescriptorCanvas.colorAttachments[0].view = context.getCurrentTexture().createView();
    const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptorCanvas);

    if (setting.isShowGBuffer) {
      passEncoder.setPipeline(renderGBufferPass.pipeline);
      passEncoder.setBindGroup(0, renderTarget.uniformBindGroup);
      passEncoder.setBindGroup(1, commonUniforms.bindGroup);
      passEncoder.setVertexBuffer(0, renderScreenVertex.vertexBuffer, 0);
      passEncoder.draw(4, 1, 0, 0);
      passEncoder.end();
    } else {
      {
        passEncoder.setPipeline(ambientLightingPass.pipeline);
        passEncoder.setBindGroup(0, renderTarget.uniformBindGroup);
        passEncoder.setBindGroup(1, scene.ambientLight.bindGroup);
        passEncoder.setVertexBuffer(0, renderScreenVertex.vertexBuffer, 0);
        passEncoder.draw(4, 1, 0, 0);
      }
      {
        passEncoder.setPipeline(pointLightingPass.pipeline);
        passEncoder.setBindGroup(0, commonUniforms.bindGroup);
        passEncoder.setBindGroup(2, renderTarget.uniformBindGroup);

        const pointLight = scene.pointLight;
        passEncoder.setVertexBuffer(0, pointLight.vertexBuffer, 0);
        passEncoder.setIndexBuffer(pointLight.indexBuffer, GPUIndexFormat.uint32, 0);
        for (let i = 0; i < pointLight.num; i++) {
          passEncoder.setBindGroup(1, pointLight.uniform.bindGroup, [i * pointLight.uniform.dynamicBufferSize]);
          passEncoder.drawIndexed(pointLight.numIndices, 1, 0, 0, 0);
        }
      }

      if (setting.isShowLightHelper) {
        const pointLight = scene.pointLight;
        const helper = pointLight.helper;
        passEncoder.setPipeline(lightHelperPass.pipeline);
        passEncoder.setBindGroup(0, commonUniforms.bindGroup);
        passEncoder.setBindGroup(2, lightHelperPass.textureUniformsBindGroup);
        passEncoder.setVertexBuffer(0, helper.vertexBuffer, 0);
        passEncoder.setIndexBuffer(helper.indexBuffer, GPUIndexFormat.uint32, 0);
        for (let i = 0; i < pointLight.num; i++) {
          passEncoder.setBindGroup(1, helper.uniform.bindGroup, [i * helper.uniform.dynamicBufferSize]);
          passEncoder.drawIndexed(helper.numIndices, 1, 0, 0, 0);
        }
      }

      passEncoder.end();
    }

    device.queue.submit([commandEncoder.finish()]);

    requestAnimationFrame(frame);
    //
    stats.end();
  }

  function createPointLightList(numPointLights) {
    const pointLight = scene.pointLight;
    for (let i = 0; i < numPointLights; i++) {
      const light = pointLight.list[i];
      const helper = pointLight.helper.list[i];
      const hue = 360 / numPointLights * i;
      light.color = Color.createRGBFromHSV(hue, 1, 1);
      helper.color = Color.createRGBFromHSV(hue, 0.8, 0.6, 0.8);
      light.intensity = 0.03 + 20 / numPointLights;
      light.distance = 3.0;
      light.attenuation = 2.0;
      light.transform.scaleX = light.distance;
      light.transform.scaleY = light.distance;
      light.transform.scaleZ = light.distance;

      const offset = pointLight.uniform.dynamicElements * i;
      pointLight.uniform.bufferData.set(light.color, offset + 16);
      pointLight.uniform.bufferData.set([light.intensity, light.distance, light.attenuation], offset + 16 + 4 + 4);

      helper.transform.scaleX = 0.05;
      helper.transform.scaleY = 0.05;
      helper.transform.scaleZ = 0.05;
      pointLight.helper.uniform.bufferData.set(helper.color, pointLight.helper.uniform.dynamicElements * i + 16);
    }
    pointLight.num = numPointLights;
  }

  const pointLightUpdateWave = frameCount => {
    const pointLight = scene.pointLight;
    const lightLength = setting.lightNum;
    const time = frameCount / 10;
    const phaseShiftFactor = Math.PI * 2 / lightLength;
    for (let i = 0; i < lightLength; i++) {
      const theta = 360 / lightLength * i * RAD;
      const transform = pointLight.list[i].transform;
      transform.x = 3 * Math.cos(theta);
      transform.y = Math.cos(time + phaseShiftFactor * i);
      transform.z = 3 * Math.sin(theta);
    }
  }

  const pointLightUpdateSpiral = frameCount => {
    const pointLight = scene.pointLight;
    const lightLength = setting.lightNum;
    const time = frameCount / 20;
    const time2 = frameCount / 40;
    const time3 = frameCount / 50;
    for (let i = 0; i < lightLength; i++) {
      const theta = 360 / lightLength * i * RAD;
      const r = 2 * (Math.cos(time2 + 0.05 * i) + 1.5);
      const transform = pointLight.list[i].transform;
      transform.x = r * Math.cos(time + theta);
      transform.y = Math.cos(time3 + 0.05 * i);
      transform.z = r * Math.sin(time + theta);
    }
  }

  const pointLightUpdateRandom = () => {
    const pointLight = scene.pointLight;
    const lightLength = setting.lightNum;
    for (let i = 0; i < lightLength; i++) {
      createTween(pointLight.list[i]);
    }
  }

  const createTween = target => {
    const targetX = (Math.random() - 0.5) * 8;
    const targetY = Math.random() * 4 - 2;
    const targetZ = (Math.random() - 0.5) * 8;
    const delay = (200 + Math.random() * 600) / 1000;
    const time = (1500 + Math.random() * 2000) / 1000;

    const tween = Tween24.tween(target.transform, time, Ease24._6_ExpoInOut, {
      x: targetX,
      y: targetY,
      z: targetZ
    }).delay(delay).onComplete(() => {
      createTween(target);
    }).groupId(MOVEMENT_TYPE_RANDOM);
    if (target.tween) {
      target.tween.stop();
    }
    target.tween = tween;
    tween.play();
  }

  requestAnimationFrame(frame);
}

async function createBuffers(device, primitive) {
  const vertices = primitive.attributeBufferDataList[0];
  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertices.buffer);

  // primitive.indexList = Primitive.createWireframeIndices(primitive.indexList);
  const indices = new Uint32Array(primitive.indexList);
  const numIndices = indices.length;
  const indexBuffer = device.createBuffer({
    size: indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(indexBuffer, 0, indices.buffer);

  return {
    vertexBuffer,
    indexBuffer,
    numIndices
  };
}

async function createUniform(device, uniformsBindGroupLayout) {
  const uniformBufferSize = (16 + 4) * Float32Array.BYTES_PER_ELEMENT;

  const uniformBuffer = device.createBuffer({
    size: uniformBufferSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const uniformBindGroup = device.createBindGroup({
    layout: uniformsBindGroupLayout,
    entries: [{
      binding: 0,
      resource: {
        buffer: uniformBuffer,
        offset: 0,
        size: uniformBufferSize,
      }
    }]
  });

  return {
    transform: new SceneObject(),
    uniform: {
      buffer: uniformBuffer,
      bindGroup: uniformBindGroup,
    }
  };
}

async function createUniformList(device, uniformsBindGroupLayout, num, floatElementsPerObj) {
  const FLOAT_ELEMENTS_ALIGNMENT = 256 / Float32Array.BYTES_PER_ELEMENT;
  const alignedFloatElementsPerObj = Math.ceil(floatElementsPerObj / FLOAT_ELEMENTS_ALIGNMENT) * FLOAT_ELEMENTS_ALIGNMENT;
  const uniformBufferSizePerObj = alignedFloatElementsPerObj * Float32Array.BYTES_PER_ELEMENT;
  const uniformBufferByteSize = uniformBufferSizePerObj * num;
  const uniformBufferData = new Float32Array(alignedFloatElementsPerObj * num);

  const uniformBuffer = device.createBuffer({
    size: uniformBufferByteSize,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const uniformBindGroup = device.createBindGroup({
    layout: uniformsBindGroupLayout,
    entries: [{
      binding: 0,
      resource: {
        buffer: uniformBuffer,
        offset: 0,
        size: floatElementsPerObj * Float32Array.BYTES_PER_ELEMENT,
      }
    }]
  });

  const transformList = [];
  for (let i = 0; i < num; i++) {
    transformList[i] = new SceneObject();
  }

  return {
    transformList,
    uniform: {
      buffer: uniformBuffer,
      bufferData: uniformBufferData,
      dynamicElements: alignedFloatElementsPerObj,
      dynamicBufferSize: uniformBufferSizePerObj,
      bindGroup: uniformBindGroup,
    }
  };
}

async function createRenderTarget(device, swapChainFormat, width, height) {
  const getShader = (group) => `
  @group(${group}) @binding(0) var filteringSampler: sampler;
  @group(${group}) @binding(1) var nonFilteringSampler: sampler;
  @group(${group}) @binding(2) var diffuseTexture: texture_2d<f32>;
  @group(${group}) @binding(3) var normalTexture: texture_2d<f32>;
  @group(${group}) @binding(4) var depthTexture: texture_2d<f32>;

  fn reconstructWorldSpacePositionFromDepth(
    depthValue: f32,
    uv: vec2<f32>,
    inverseViewProjectionMatrix: mat4x4<f32>
  ) -> vec3<f32> {
    var screenSpacePositionXY:vec2<f32> = uv * 2.0 - vec2<f32>(1.0, 1.0);
    screenSpacePositionXY.y = -screenSpacePositionXY.y;
    var screenSpacePosition:vec4<f32> = vec4<f32>(screenSpacePositionXY, depthValue, 1.0);
    var worldSpacePosition:vec4<f32> = inverseViewProjectionMatrix * screenSpacePosition;
    return vec3<f32>(worldSpacePosition.xyz / worldSpacePosition.www);
  }
  `;
  const createTexture = (format, w, h) => device.createTexture({
    size: {
      width: w,
      height: h,
      depthOrArrayLayers: 1
    },
    mipLevelCount: 1,
    sampleCount: 1,
    dimension: GPUTextureDimension.texture_2d,
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
  });

  const diffuseTexture = {
    texture: undefined,
    view: undefined
  };
  const normalTexture = {
    texture: undefined,
    view: undefined
  };
  const depthTexture = {
    texture: undefined,
    view: undefined
  };
  const resizeTexture = (targetTexture, format, w, h) => {
    if (targetTexture.texture) {
      targetTexture.texture.destroy();
    }
    targetTexture.texture = createTexture(format, w, h);
    targetTexture.view = targetTexture.texture.createView();
  }
  const resize = (w, h) => {
    resizeTexture(diffuseTexture, swapChainFormat, w, h);
    resizeTexture(normalTexture, GPUTextureFormat.rgba16float, w, h);
    resizeTexture(depthTexture, GPUTextureFormat.depth32float, w, h);
  };
  resize(width, height);

  const filteringSampler = device.createSampler({
    magFilter: GPUFilterMode.linear,
    minFilter: GPUFilterMode.linear,
  });
  const nonFilteringSampler = device.createSampler();

  const uniformsBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {type: GPUSamplerBindingType.filtering}
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {type: GPUSamplerBindingType.non_filtering}
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: GPUTextureSampleType.float, // diffuse
          viewDimension: GPUTextureViewDimension.texture_2d,
          multisampled: false
        }
      },
      {
        binding: 3,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: GPUTextureSampleType.float, // normal
          viewDimension: GPUTextureViewDimension.texture_2d,
          multisampled: false
        }
      },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: GPUTextureSampleType.unfilterable_float, // depth
          viewDimension: GPUTextureViewDimension.texture_2d,
          multisampled: false
        }
      },
    ]
  });

  const createUniformBindGroup = () => device.createBindGroup({
    layout: uniformsBindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: filteringSampler
      },
      {
        binding: 1,
        resource: nonFilteringSampler
      },
      {
        binding: 2,
        resource: diffuseTexture.view
      },
      {
        binding: 3,
        resource: normalTexture.view
      },
      {
        binding: 4,
        resource: depthTexture.view
      },
    ]
  });
  const uniformBindGroup = createUniformBindGroup();

  return {
    getShader,
    diffuseTexture,
    normalTexture,
    depthTexture,
    uniformBindGroup,
    uniformsBindGroupLayout,
    resize,
    createUniformBindGroup,
  };
}

async function createCommonUniforms(device) {
  const getShader = (group, variableName) => `
  struct CommonUniforms {
    vpMatrix : mat4x4<f32>,
    inverseVPMatrix : mat4x4<f32>,
    screen : vec4<f32>
  };
  @binding(0) @group(${group}) var<uniform> ${variableName} : CommonUniforms;
  `;

  const commonUniformsBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {type: GPUBufferBindingType.uniform}
    }]
  });

  const commonUniformBufferData = new Float32Array(2 * 16 + 4);
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

  return {
    bindGroupLayout: commonUniformsBindGroupLayout,
    bindGroup: commonUniformBindGroup,
    buffer: commonUniformBuffer,
    bufferData: commonUniformBufferData,
    getShader
  };
}

async function createGeometryPass(device, swapChainFormat, width, height, renderTarget, commonUniforms) {
  // language=WGSL
  const vertexShaderWGSL = `
  ${commonUniforms.getShader(0, "commonUniforms")}

  struct ModelUniforms {
    mMatrix : mat4x4<f32>,
    color : vec4<f32>
  };
  @binding(0) @group(1) var<uniform> modelUniforms : ModelUniforms;

  struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) vColor : vec4<f32>,
    @location(1) vNormal : vec3<f32>
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
    var nMatrix:mat3x3<f32> = mat3x3<f32>(
      modelUniforms.mMatrix[0].xyz,
      modelUniforms.mMatrix[1].xyz,
      modelUniforms.mMatrix[2].xyz
    );
    output.vColor = modelUniforms.color;
    output.vNormal = normal * inverse3x3(nMatrix);
    output.position = commonUniforms.vpMatrix * modelUniforms.mMatrix * vec4<f32>(position, 1.0);
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
  struct FragmentOutput {
    @location(0) outDiffuse: vec4<f32>,
    @location(1) outNormal: vec4<f32>
  };

  @fragment
  fn main(
    @location(0) vColor: vec4<f32>,
    @location(1) vNormal: vec3<f32>,
  ) -> FragmentOutput {
    var output : FragmentOutput;
    output.outDiffuse = vColor;
    output.outNormal = vec4<f32>(normalize(vNormal), 1.0);
    return output;
  }
  `;
  const gpuFragmentState = {
    module: device.createShaderModule({code: fragmentShaderWGSL}),
    entryPoint: "main"
  }
  if (gpuVertexState.module.compilationInfo) {
    console.log(await gpuFragmentState.module.compilationInfo());
  }

  const modelUniformsBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        type: GPUBufferBindingType.uniform,
        hasDynamicOffset: true
      }
    }]
  });

  const vertexSize = Float32Array.BYTES_PER_ELEMENT * 6;
  const positionOffset = Float32Array.BYTES_PER_ELEMENT * 0;
  const normalOffset = Float32Array.BYTES_PER_ELEMENT * 3;

  const defaultBlending = {
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
  };
  const gpuRenderPipelineDescriptor = {
    layout: device.createPipelineLayout({
      bindGroupLayouts: [commonUniforms.bindGroupLayout, modelUniformsBindGroupLayout]
    }),

    vertex: Object.assign(gpuVertexState, {
      buffers: [{
        arrayStride: vertexSize,
        stepMode: GPUVertexStepMode.vertex,
        attributes: [
          {
            // position
            shaderLocation: 0,
            offset: positionOffset,
            format: GPUVertexFormat.float32x3
          },
          {
            // normal
            shaderLocation: 1,
            offset: normalOffset,
            format: GPUVertexFormat.float32x3
          }
        ]
      }]
    }),

    fragment: Object.assign(gpuFragmentState, {
      targets: [
        {format: swapChainFormat, blend: defaultBlending}, // diffuse
        {format: GPUTextureFormat.rgba16float, blend: defaultBlending}, // normal
      ].map(({format, blend}) => {
        return {
          format,
          blend,
          writeMask: GPUColorWrite.ALL
        };
      })
    }),

    primitive: {
      topology: GPUPrimitiveTopology.triangle_list,
      frontFace: GPUFrontFace.ccw,
      cullMode: GPUCullMode.back
    },

    depthStencil: {
      depthWriteEnabled: true,
      depthCompare: GPUCompareFunction.less_equal,
      format: GPUTextureFormat.depth32float
    }
  };
  const pipeline = device.createRenderPipeline(gpuRenderPipelineDescriptor);
  const createDepthTexture = (w, h) => device.createTexture({
    size: {
      width: w,
      height: h,
      depthOrArrayLayers: 1
    },
    mipLevelCount: 1,
    sampleCount: 1,
    dimension: GPUTextureDimension.texture_2d,
    format: GPUTextureFormat.depth24plus,
    usage: GPUTextureUsage.RENDER_ATTACHMENT
  });

  const renderPassDescriptor = {
    colorAttachments: [
      {
        clearValue: {r: 0.0, g: 0.0, b: 0.0, a: 1.0},
        loadOp: GPULoadOp.clear,
        storeOp: GPUStoreOp.store,
        view: renderTarget.diffuseTexture.view,
      },
      {
        clearValue: {r: 0.0, g: 0.0, b: 0.0, a: 1.0},
        loadOp: GPULoadOp.clear,
        storeOp: GPUStoreOp.store,
        view: renderTarget.normalTexture.view,
      }
    ],

    depthStencilAttachment: {
      view: renderTarget.depthTexture.view,
      depthClearValue: 1.0,
      depthLoadOp: GPULoadOp.clear,
      depthStoreOp: GPUStoreOp.store,
    }
  };

  return {
    modelUniformsBindGroupLayout,
    pipeline,
    renderPassDescriptor
  };
}

async function createRenderScreenVertex(device) {
  const vertexSize = Float32Array.BYTES_PER_ELEMENT * 4; // Byte size of one vertex.
  const uvOffset = Float32Array.BYTES_PER_ELEMENT * 2; // Byte offset of vertex color attribute.
  const vertices = new Float32Array([
    // float2 position, float2 uv
    -1.0, -1.0, 0.0, 1.0,
    1.0, -1.0, 1.0, 1.0,
    -1.0, 1.0, 0.0, 0.0,
    1.0, 1.0, 1.0, 0.0,
  ]);
  const vertexBuffer = device.createBuffer({
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertices.buffer);

  return {
    vertexBuffer,
    vertexSize,
    uvOffset
  };
}

async function createRenderGBufferPass(device, swapChainFormat, renderTarget, commonUniforms, renderScreenVertex) {
  // language=WGSL
  const vertexShaderWGSL = `
  struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) vUV : vec2<f32>
  };

  @vertex
  fn main(
    @location(0) position : vec2<f32>,
    @location(1) uv : vec2<f32>
  ) -> VertexOutput {
    var output : VertexOutput;
    output.vUV = uv;
    output.position = vec4<f32>(position, 0.0, 1.0);
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
  ${renderTarget.getShader(0)}
  ${commonUniforms.getShader(1, "commonUniforms")}

  @fragment
  fn main(
    @location(0) vUV: vec2<f32>
  ) -> @location(0) vec4<f32> {
    var uv:vec2<f32>;
    var diffuseColor:vec4<f32> = vec4<f32>(0.0, 0.0, 0.0, 0.0);

    uv = vUV * 2.0 + vec2<f32>(0.0, -1.0);
    var tmpTexture:vec4<f32> = textureSample(diffuseTexture, filteringSampler, uv);
    if (vUV.x < 0.5 && vUV.y >= 0.5){
      diffuseColor = tmpTexture;
    }

    var normalColor:vec4<f32> = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    uv = vUV * 2.0 + vec2<f32>(-1.0, 0.0);
    tmpTexture = textureSample(normalTexture, filteringSampler, uv);
    if (vUV.x >= 0.5 && vUV.y < 0.5){
      normalColor = vec4<f32>((tmpTexture.xyz + vec3<f32>(1.0, 1.0, 1.0)) * 0.5, tmpTexture.w);
    }

    var positionColor:vec4<f32> = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    uv = vUV * 2.0;
//    var depthValue:f32 = textureSample(depthTexture, nonFilteringSampler, uv).x;
    var depthValue:f32 = textureSample(depthTexture, nonFilteringSampler, uv).r;
    //  positionColor = textureSample(positionTexture, filteringSampler, uv);
    if (vUV.x < 0.5 && vUV.y < 0.5){
      if (depthValue != 1.0){
        positionColor = vec4<f32>(reconstructWorldSpacePositionFromDepth(depthValue, uv, commonUniforms.inverseVPMatrix), 0.0);
      }
      positionColor = vec4<f32>((positionColor.xyz + vec3<f32>(4.0, 4.0, 4.0)) * 0.125, 1.0);
    }

    var depthColor:vec4<f32> = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    uv = vUV * 2.0 + vec2<f32>(-1.0, -1.0);
    depthValue = textureSample(depthTexture, nonFilteringSampler, uv).r;
    if (vUV.x >= 0.5 && vUV.y >= 0.5){
      if(depthValue == 1.0){
        depthValue = 0.0;
      }
      depthColor = vec4<f32>(vec3<f32>(depthValue), 1.0);
    }

    return diffuseColor + normalColor + positionColor + depthColor;
  }
  `;
  const gpuFragmentState = {
    module: device.createShaderModule({code: fragmentShaderWGSL}),
    entryPoint: "main"
  }
  if (gpuVertexState.module.compilationInfo) {
    console.log(await gpuFragmentState.module.compilationInfo());
  }

  const gpuRenderPipelineDescriptor = {
    layout: device.createPipelineLayout({bindGroupLayouts: [renderTarget.uniformsBindGroupLayout, commonUniforms.bindGroupLayout]}),

    vertex: Object.assign(gpuVertexState, {
      buffers: [{
        arrayStride: renderScreenVertex.vertexSize,
        stepMode: GPUVertexStepMode.vertex,
        attributes: [
          {
            // position
            shaderLocation: 0,
            offset: 0,
            format: GPUVertexFormat.float32x2
          },
          {
            // uv
            shaderLocation: 1,
            offset: renderScreenVertex.uvOffset,
            format: GPUVertexFormat.float32x2
          }
        ]
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
      topology: GPUPrimitiveTopology.triangle_strip,
      stripIndexFormat: GPUIndexFormat.uint16,
      frontFace: GPUFrontFace.ccw,
      cullMode: GPUCullMode.back
    }
  };

  const pipeline = device.createRenderPipeline(gpuRenderPipelineDescriptor);

  return {
    pipeline
  };
}

async function createAmbientLightingPass(device, swapChainFormat, renderTarget, renderScreenVertex) {
  // language=WGSL
  const vertexShaderWGSL = `
  struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) vUV : vec2<f32>
  };

  @vertex
  fn main(
    @location(0) position : vec2<f32>,
    @location(1) uv : vec2<f32>
  ) -> VertexOutput {
    var output : VertexOutput;
    output.vUV = uv;
    output.position = vec4<f32>(position, 0.0, 1.0);
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
  ${renderTarget.getShader(0)}

  struct AmbientLightUniforms {
    color : vec4<f32>,
    intensity : f32,
    padding1 : f32,
    padding2 : f32,
    padding3 : f32
  };
  @binding(0) @group(1) var<uniform> ambientLightUniforms : AmbientLightUniforms;

  @fragment
  fn main(
    @location(0) vUV: vec2<f32>,
  ) -> @location(0) vec4<f32> {
    var diffuseColor:vec4<f32> = textureSample(diffuseTexture, filteringSampler, vUV);
    return diffuseColor * ambientLightUniforms.color * vec4<f32>(vec3<f32>(ambientLightUniforms.intensity), 1.0);
  }
  `;
  const gpuFragmentState = {
    module: device.createShaderModule({code: fragmentShaderWGSL}),
    entryPoint: "main"
  }
  if (gpuVertexState.module.compilationInfo) {
    console.log(await gpuFragmentState.module.compilationInfo());
  }

  const ambientLightUniformsBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.FRAGMENT,
      buffer: {
        type: GPUBufferBindingType.uniform,
        hasDynamicOffset: false
      }
    }]
  });

  const gpuRenderPipelineDescriptor = {
    layout: device.createPipelineLayout({bindGroupLayouts: [renderTarget.uniformsBindGroupLayout, ambientLightUniformsBindGroupLayout]}),

    vertex: Object.assign(gpuVertexState, {
      buffers: [{
        arrayStride: renderScreenVertex.vertexSize,
        stepMode: GPUVertexStepMode.vertex,
        attributes: [
          {
            // position
            shaderLocation: 0,
            offset: 0,
            format: GPUVertexFormat.float32x2
          },
          {
            // uv
            shaderLocation: 1,
            offset: renderScreenVertex.uvOffset,
            format: GPUVertexFormat.float32x2
          }
        ]
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
      topology: GPUPrimitiveTopology.triangle_strip,
      stripIndexFormat: GPUIndexFormat.uint16,
      frontFace: GPUFrontFace.ccw,
      cullMode: GPUCullMode.back
    }
  };

  const pipeline = device.createRenderPipeline(gpuRenderPipelineDescriptor);

  return {
    pipeline,
    ambientLightUniformsBindGroupLayout
  };
}

async function createPointLightingPass(device, swapChainFormat, commonUniforms, renderTarget) {
  const pointLightUniformsShader = `
  struct PointLightUniforms {
    mMatrix : mat4x4<f32>,
    color : vec4<f32>,
    position : vec3<f32>,
    padding1: f32,
    intensity : f32,
    distance : f32,
    attenuation : f32,
    padding2: f32
  };
  @binding(0) @group(1) var<uniform> pointLightUniforms : PointLightUniforms;
  `;

  const pointLightUniformsBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
      buffer: {
        type: GPUBufferBindingType.uniform,
        hasDynamicOffset: true
      }
    }]
  });

  // language=WGSL
  const vertexShaderWGSL = `
  ${commonUniforms.getShader(0, "commonUniforms")}
  ${pointLightUniformsShader}

  struct VertexOutput {
    @builtin(position) position : vec4<f32>
  };

  @vertex
  fn main(
    @location(0) position : vec3<f32>
  ) -> VertexOutput {
    var output : VertexOutput;
    output.position = commonUniforms.vpMatrix * pointLightUniforms.mMatrix * vec4<f32>(position, 1.0);
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
  ${commonUniforms.getShader(0, "commonUniforms")}
  ${pointLightUniformsShader}
  ${renderTarget.getShader(2, "commonUniforms")}

  @fragment
  fn main(
    @builtin(position) fragCoord: vec4<f32>
  ) -> @location(0) vec4<f32> {
    var uv:vec2<f32> = fragCoord.xy * commonUniforms.screen.zw;
    //  var pos:vec3<f32> = textureSample(positionTexture, filteringSampler, uv).xyz;
    var depthValue:f32 = textureSample(depthTexture, nonFilteringSampler, uv).r;
    var pos:vec3<f32> = reconstructWorldSpacePositionFromDepth(depthValue, uv, commonUniforms.inverseVPMatrix);
    var normal:vec3<f32> = normalize(textureSample(normalTexture, filteringSampler, uv).xyz);
    var diffuseColor:vec4<f32> = textureSample(diffuseTexture, filteringSampler, uv);

    var lightVector:vec3<f32> = pointLightUniforms.position - pos;

    var diffuse:f32 = clamp(dot(normal, normalize(lightVector)), 0.0, 1.0);
    var attenuation:f32 = pow(clamp(1.0 - length(lightVector) / pointLightUniforms.distance, 0.0, 1.0), pointLightUniforms.attenuation);
    var diffuseFactor:f32 = diffuse * attenuation * pointLightUniforms.intensity;
    var color:vec4<f32> = diffuseColor * pointLightUniforms.color * vec4<f32>(diffuseFactor, diffuseFactor, diffuseFactor, 1.0);

    return color;
  }
  `;
  const gpuFragmentState = {
    module: device.createShaderModule({code: fragmentShaderWGSL}),
    entryPoint: "main"
  }
  if (gpuVertexState.module.compilationInfo) {
    console.log(await gpuFragmentState.module.compilationInfo());
  }

  const gpuRenderPipelineDescriptor = {
    layout: device.createPipelineLayout({bindGroupLayouts: [commonUniforms.bindGroupLayout, pointLightUniformsBindGroupLayout, renderTarget.uniformsBindGroupLayout]}),

    vertex: Object.assign(gpuVertexState, {
      buffers: [{
        arrayStride: Float32Array.BYTES_PER_ELEMENT * 3,
        stepMode: GPUVertexStepMode.vertex,
        attributes: [{
          // position
          shaderLocation: 0,
          offset: 0,
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
            dstFactor: GPUBlendFactor.one,
            operation: GPUBlendOperation.add
          },
          alpha: {
            srcFactor: GPUBlendFactor.one,
            dstFactor: GPUBlendFactor.one,
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
    }
  };

  const pipeline = device.createRenderPipeline(gpuRenderPipelineDescriptor);

  return {
    pipeline,
    pointLightUniformsBindGroupLayout
  };
}

async function createLightHelperPass(device, swapChainFormat, depthTexture, commonUniforms) {
  // language=WGSL
  const vertexShaderWGSL = `
  ${commonUniforms.getShader(0, "commonUniforms")}

  struct ModelUniforms {
    mMatrix : mat4x4<f32>,
    color : vec4<f32>
  };
  @binding(0) @group(1) var<uniform> modelUniforms : ModelUniforms;

  struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) vColor : vec4<f32>,
    @location(1) vDepth : f32
  };

  @vertex
  fn main(
    @location(0) position : vec3<f32>
  ) -> VertexOutput {
    var output : VertexOutput;
    output.vColor = modelUniforms.color;
    output.position = commonUniforms.vpMatrix * modelUniforms.mMatrix * vec4<f32>(position, 1.0);
    output.vDepth = output.position.z / output.position.w;
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
  ${commonUniforms.getShader(0, "commonUniforms")}

  @group(2) @binding(0) var nonFilteringSampler: sampler;
  @group(2) @binding(1) var depthTexture: texture_2d<f32>;

  @fragment
  fn main(
    @builtin(position) fragCoord: vec4<f32>,
    @location(0) vColor: vec4<f32>,
    @location(1) vDepth: f32
  ) -> @location(0) vec4<f32> {
    var uv:vec2<f32> = fragCoord.xy * commonUniforms.screen.zw;
    var depth:vec4<f32> = textureSample(depthTexture, nonFilteringSampler, uv);
    if (depth.r <= 0.0 || vDepth < depth.r)
    {
      return vColor;
    }
    else
    {
      discard;
    }
    return vec4<f32>(0.0, 0.0, 0.0, 0.0);
  }
  `;
  const gpuFragmentState = {
    module: device.createShaderModule({code: fragmentShaderWGSL}),
    entryPoint: "main"
  }
  if (gpuVertexState.module.compilationInfo) {
    console.log(await gpuFragmentState.module.compilationInfo());
  }

  const modelUniformsBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.VERTEX,
      buffer: {
        type: GPUBufferBindingType.uniform,
        hasDynamicOffset: true
      }
    }]
  });

  const nonFilteringSampler = device.createSampler();

  const textureUniformsBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {type: GPUSamplerBindingType.non_filtering}
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: GPUTextureSampleType.unfilterable_float,
          viewDimension: GPUTextureViewDimension.texture_2d,
          multisampled: false
        }
      }
    ]
  });

  const createTextureUniformsBindGroup = depthTexture => device.createBindGroup({
    layout: textureUniformsBindGroupLayout,
    entries: [
      {
        binding: 0,
        resource: nonFilteringSampler
      },
      {
        binding: 1,
        resource: depthTexture.view
      }
    ]
  });
  const textureUniformsBindGroup = createTextureUniformsBindGroup(depthTexture);

  const vertexSize = Float32Array.BYTES_PER_ELEMENT * 3;
  const positionOffset = Float32Array.BYTES_PER_ELEMENT * 0;

  const gpuRenderPipelineDescriptor = {
    layout: device.createPipelineLayout({
      bindGroupLayouts: [commonUniforms.bindGroupLayout, modelUniformsBindGroupLayout, textureUniformsBindGroupLayout]
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
            srcFactor: GPUBlendFactor.src_alpha,
            dstFactor: GPUBlendFactor.one_minus_src_alpha,
            operation: GPUBlendOperation.add
          },
          alpha: {
            srcFactor: GPUBlendFactor.one,
            dstFactor: GPUBlendFactor.one,
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
    }
  };
  const pipeline = device.createRenderPipeline(gpuRenderPipelineDescriptor);

  return {
    textureUniformsBindGroup,
    pipeline,
    createTextureUniformsBindGroup
  };
}

async function createScene(device, modelUniformsBindGroupLayout, pointLightUniformsBindGroupLayout, ambientLightUniformsBindGroupLayout) {
  const attributeSet = [[PrimitiveAttribute.POSITION, PrimitiveAttribute.NORMAL]];

  const whiteColor = new Float32Array([1.0, 1.0, 1.0, 1.0]);
  const modelUniformCopySource = new Float32Array(16 + 4);

  const plane = {
    ...await createBuffers(device, Primitive.createPlane(8.0, 8.0, 10, 10, attributeSet)),
    ...await createUniform(device, modelUniformsBindGroupLayout)
  };
  plane.transform.rotationX = -90 * RAD;
  plane.transform.y = -2;
  modelUniformCopySource.set(plane.transform.getModelMatrix(), 0);
  modelUniformCopySource.set(whiteColor, 16);
  device.queue.writeBuffer(plane.uniform.buffer, 0, modelUniformCopySource.buffer);

  const sphere = {
    ...await createBuffers(device, Primitive.createSphere(0.5, 20, 20, attributeSet)),
    ...await createUniform(device, modelUniformsBindGroupLayout)
  };
  sphere.transform.scaleX = 2;
  sphere.transform.scaleY = 2;
  sphere.transform.scaleZ = 2;
  modelUniformCopySource.set(sphere.transform.getModelMatrix(), 0);
  modelUniformCopySource.set(whiteColor, 16);
  device.queue.writeBuffer(sphere.uniform.buffer, 0, modelUniformCopySource.buffer);

  const torusNum = 30;
  const torus = {
    ...await createBuffers(device, Primitive.createTorus(0.3, 0.1, 20, 20, attributeSet)),
    ...await createUniformList(device, modelUniformsBindGroupLayout, torusNum, 16 + 4)
  };

  const rotationList = [];
  for (let i = 0; i < torusNum; i++) {
    const transform = torus.transformList[i];
    const r = 1.5 + Math.random() * 3;
    const theta = Math.random() * 360 * RAD;
    transform.x = r * Math.cos(theta);
    transform.y = Math.random() * 3.5 - 1.5;
    transform.z = r * Math.sin(theta);

    const axis = vec3.fromValues(Math.random() - 0.5, Math.random() - 0.5, 0.0);
    vec3.normalize(axis, axis);

    const angle = Math.random() * 360 * RAD;
    rotationList[i] = angle;
    quat.setAxisAngle(transform.quaternion, axis, angle);
    transform.rotationDirty = false;
    rotationList[i] = {
      axis,
      angle,
      speed: 0.02 + Math.random() * 0.04
    };

    torus.uniform.bufferData.set([Math.random(), Math.random(), Math.random(), 1.0], torus.uniform.dynamicElements * i + 16);
  }
  torus.rotationList = rotationList;
  torus.num = torusNum;

  const ambientLightUniformBufferData = new Float32Array(8);
  const ambientLightuniformBuffer = device.createBuffer({
    size: ambientLightUniformBufferData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  const ambientLightUniformBindGroup = device.createBindGroup({
    layout: ambientLightUniformsBindGroupLayout,
    entries: [{
      binding: 0,
      resource: {
        buffer: ambientLightuniformBuffer,
        offset: 0,
        size: ambientLightUniformBufferData.byteLength,
      }
    }]
  });

  const ambientLight = {
    buffer: ambientLightuniformBuffer,
    bufferData: ambientLightUniformBufferData,
    bindGroup: ambientLightUniformBindGroup,
  }

  const pointLightNum = MAX_LIGHT_NUM;
  const pointLight = {
    ...await createBuffers(device, Primitive.createSphere(1.0, 10, 10, [[PrimitiveAttribute.POSITION]])),
    ...await createUniformList(device, pointLightUniformsBindGroupLayout, pointLightNum, 16 + 12),
    helper: {
      ...await createBuffers(device, Primitive.createSphere(1.0, 8, 8, [[PrimitiveAttribute.POSITION]])),
      ...await createUniformList(device, modelUniformsBindGroupLayout, pointLightNum, 16 + 4)
    }
  };
  const pointLightList = [];
  const pointLightHelperList = [];
  for (let i = 0; i < pointLightNum; i++) {
    const color = undefined;
    const intensity = 0.0;
    const distance = 0.0;
    const attenuation = 0.0;
    const transform = new SceneObject();
    pointLightList[i] = {
      color,
      intensity,
      distance,
      attenuation,
      transform
    };

    const helperTransform = new SceneObject();
    pointLightHelperList[i] = {
      color: undefined,
      transform: helperTransform
    };
  }
  pointLight.list = pointLightList;
  pointLight.helper.list = pointLightHelperList;

  return {
    plane,
    sphere,
    torus,
    pointLight,
    ambientLight
  }
}

const consoleMatrix = matrix => {
  console.table([0, 1, 2, 3].map(i => matrix.slice(i * 4, i * 4 + 4)))
};

window.addEventListener("DOMContentLoaded", init);
