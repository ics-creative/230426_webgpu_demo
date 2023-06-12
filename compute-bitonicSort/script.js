import {GPUBufferBindingType} from "../libs/webgpu/GPUEnum.js";
import {ReadbackBuffer} from '../libs/webgpu/ReadbackBuffer.js';

let MAX_THREAD_NUM = 0;
let MAX_GROUP_NUM = 0;

let logElement;
let selectBox;

let adapter;
let device;

let bitonicSortPipelne1;
let bitonicSortPipelne2;
let bitonicSortPipelne3;
let computeSSBOBindGroupLayout;
let computeUniformBindGroupLayout;

async function init() {
  selectBox = document.getElementById('selectBox');
  selectBox.disabled = true;

  adapter = await navigator.gpu?.requestAdapter();
  device = await adapter?.requestDevice({});

  if (!adapter || !device) {
    notSupportedDescription.style.display = "block";
    contents.style.display = "none";
    return;
  }
  notSupportedDescription.style.display = "none";
  contents.style.display = "block";

  MAX_THREAD_NUM = device.limits.maxComputeWorkgroupSizeX;
  MAX_GROUP_NUM = 1 << (Math.log2(device.limits.maxComputeWorkgroupsPerDimension) << 0);

  const maxNumElementsIndex = Math.log2(MAX_THREAD_NUM * MAX_GROUP_NUM) - 7;
  for (let i = 0; i < maxNumElementsIndex; i++) {
    const option = document.createElement('option');
    option.text = '' + getLength(i);
    selectBox.add(option);
  }
  selectBox.selectedIndex = 7;
  selectBox.addEventListener('change', () => {
    logElement.innerText = '';
    if (getLength(selectBox.selectedIndex) >= 1 << 20) {
      log(`\n注意\n大きな要素数を選択すると、CPUでのソート時間が増大し、ブラウザが数秒間フリーズしてみえることがあります。\n`);
    }
    selectBox.disabled = true;
    requestAnimationFrame(() => requestAnimationFrame(() => compute()));
  });

  logElement = document.getElementById('log');

  initializeComputeProgram();

  compute();
}

const compute = async () => {
  const length = getLength(selectBox.selectedIndex);
  const arr = new Float32Array(length);
  resetData(arr, length);

  await computeCPU(arr.slice(0));
  log(`\n----------\n`);
  await computeGPU(arr.slice(0));

  selectBox.disabled = false;
  console.log(`---`);
};

const computeCPU = async (arr) => {
  const now = performance.now();
  arr.sort(
    (a, b) => {
      return a - b;
    }
  );
  logElement.innerText = '';
  log(`\nソート対象: ${arr.length}要素\n`);
  log(`CPUでの実行時間: ${Math.round(performance.now() - now)} ms`);
  log(`ソート結果の正当性チェック: ${validateSorted(arr) ? '成功' : '失敗'}`);

  // console.log(arr);
};

const computeGPU = async (arr) => {
  const now = performance.now();

  const length = arr.length;
  const threadgroupsPerGrid = Math.max(1, length / MAX_THREAD_NUM);

  const result = new Float32Array(length);
  const readbackBuffer = new ReadbackBuffer(result);
  readbackBuffer.createBuffer(device);

  const storageBuffer = device.createBuffer({
    size: arr.byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
  });
  device.queue.writeBuffer(storageBuffer, 0, arr.buffer);

  const storageBufferBindGroup = device.createBindGroup({
    layout: computeSSBOBindGroupLayout,
    entries: [{
      binding: 0,
      resource: {
        buffer: storageBuffer,
        offset: 0,
        size: arr.byteLength,
      },
    }],
  });

  // compute
  const commandEncoder = device.createCommandEncoder({});

  const passEncoder = commandEncoder.beginComputePass();
  passEncoder.setPipeline(bitonicSortPipelne1);
  passEncoder.setBindGroup(0, storageBufferBindGroup);
  passEncoder.dispatchWorkgroups(threadgroupsPerGrid, 1, 1);

  let uniformBuffer;
  if (threadgroupsPerGrid > 1) {
    const numK3Dispatches = Math.log2(threadgroupsPerGrid);
    const numK2Dispatches = (1 + numK3Dispatches) * numK3Dispatches / 2;
    // console.log({numK3Dispatches, numK2Dispatches});

    const MINIMUM_UNIFORM_OFFSET_ALIGNMENT = 256;
    const elementsPerDispatch = MINIMUM_UNIFORM_OFFSET_ALIGNMENT / Uint32Array.BYTES_PER_ELEMENT;
    const uniformBufferData = new Uint32Array(numK2Dispatches * elementsPerDispatch);

    let offset = 0;
    for (let k = MAX_THREAD_NUM * 2; k <= length; k <<= 1) {
      for (let j = k >> 1; j >= MAX_THREAD_NUM; j >>= 1) {
        uniformBufferData[offset] = k;
        uniformBufferData[offset + 1] = j;
        offset += elementsPerDispatch;
        // console.log(k, j);
      }
    }
    uniformBuffer = device.createBuffer({
      size: uniformBufferData.byteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM
    });
    device.queue.writeBuffer(uniformBuffer, 0, uniformBufferData.buffer);

    const bytesPerDispatch = elementsPerDispatch * Uint32Array.BYTES_PER_ELEMENT;
    const uniformBufferBindGroup = device.createBindGroup({
      layout: computeUniformBindGroupLayout,
      entries: [{
        binding: 0,
        resource: {
          buffer: uniformBuffer,
          offset: 0,
          size: 4 * Uint32Array.BYTES_PER_ELEMENT,
        },
      }],
    });
    let dynamicIndex = 0;
    for (let k = 0; k < numK3Dispatches; k += 1) {
      passEncoder.setPipeline(bitonicSortPipelne2);
      for (let j = 0; j <= k; j += 1) {
        passEncoder.setBindGroup(1, uniformBufferBindGroup, [bytesPerDispatch * dynamicIndex]);
        passEncoder.dispatchWorkgroups(threadgroupsPerGrid, 1, 1);
        dynamicIndex += 1;
      }

      passEncoder.setPipeline(bitonicSortPipelne3);
      passEncoder.dispatchWorkgroups(threadgroupsPerGrid, 1, 1);
    }
  }
  passEncoder.end();

  readbackBuffer.copyBufferToBuffer(commandEncoder, storageBuffer);
  device.queue.submit([commandEncoder.finish()]);

  // get result
  await readbackBuffer.mapReadAsync();
  log(`GPUでの実行時間: ${Math.round(performance.now() - now)} ms`);
  log(`ソート結果の正当性チェック: ${validateSorted(result) ? '成功' : '失敗'}`);

  storageBuffer.destroy();
  readbackBuffer.destroy();
  if (uniformBuffer) {
    uniformBuffer.destroy();
  }
};

const resetData = (arr, sortLength) => {
  for (let i = 0; i < sortLength; i++) {
    arr[i] = Math.random();
  }
};

const validateSorted = (arr) => {
  const length = arr.length;
  for (let i = 0; i < length; i++) {
    if (i !== length - 1 && arr[i] > arr[i + 1]) {
      console.log('validation error:', i, arr[i], arr[i + 1]);
      console.log(arr);
      return false;
    }
  }
  return true;
};

const initializeComputeProgram = () => {
  // language=WGSL
  const computeShaderWGSL1 = `
  struct SSBO {
    data : array<f32>
  };
  @binding(0) @group(0) var<storage, read_write> ssbo : SSBO;

  var<workgroup> sharedData: array<f32, ${MAX_THREAD_NUM}>;

  @compute @workgroup_size(${MAX_THREAD_NUM}, 1, 1)
  fn main(
    @builtin(global_invocation_id) GlobalInvocationID : vec3<u32>,
    @builtin(local_invocation_index) LocallInvocationIndex : u32,
    @builtin(workgroup_id) WorkgroupID : vec3<u32>
  ) {
    sharedData[LocallInvocationIndex] = ssbo.data[GlobalInvocationID.x];
    workgroupBarrier();

    var offset:u32 = WorkgroupID.x * ${MAX_THREAD_NUM}u;

    var tmp:f32;
    for (var k:u32 = 2u; k <= ${MAX_THREAD_NUM}u; k = k << 1u) {
      for (var j:u32 = k >> 1u; j > 0u; j = j >> 1u) {
        var ixj:u32 = (GlobalInvocationID.x ^ j) - offset;
        if (ixj > LocallInvocationIndex) {
          if ((GlobalInvocationID.x & k) == 0u) {
            if (sharedData[LocallInvocationIndex] > sharedData[ixj]) {
              tmp = sharedData[LocallInvocationIndex];
              sharedData[LocallInvocationIndex] = sharedData[ixj];
              sharedData[ixj] = tmp;
            }
          }
          else
          {
            if (sharedData[LocallInvocationIndex] < sharedData[ixj]) {
              tmp = sharedData[LocallInvocationIndex];
              sharedData[LocallInvocationIndex] = sharedData[ixj];
              sharedData[ixj] = tmp;
            }
          }
        }
        workgroupBarrier();
      }
    }
    ssbo.data[GlobalInvocationID.x] = sharedData[LocallInvocationIndex];
  }
  `;
  const gpuComputePipelineDescriptor1 = {
    module: device.createShaderModule({code: computeShaderWGSL1}),
    entryPoint: 'main',
  };

  computeSSBOBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.COMPUTE,
      buffer: {
        type: GPUBufferBindingType.storage
      }
    },
    ]
  });
  const computePipelineLayout1 = device.createPipelineLayout({
    bindGroupLayouts: [computeSSBOBindGroupLayout],
  });

  bitonicSortPipelne1 = device.createComputePipeline({
    layout: computePipelineLayout1,
    compute: gpuComputePipelineDescriptor1
  });

  // language=WGSL
  const computeShaderWGSL2 = `
  struct SSBO {
    data : array<f32>
  };
  @binding(0) @group(0) var<storage, read_write> ssbo : SSBO;

  struct Uniforms {
    numElements : vec4<u32>
  };
  @binding(0) @group(1) var<uniform> uniforms : Uniforms;

  @compute @workgroup_size(${MAX_THREAD_NUM}, 1, 1)
  fn main(
    @builtin(global_invocation_id) GlobalInvocationID : vec3<u32>
  ) {
    var tmp:f32;
    var ixj:u32 = GlobalInvocationID.x ^ uniforms.numElements.y;
    if (ixj > GlobalInvocationID.x)
    {
      if ((GlobalInvocationID.x & uniforms.numElements.x) == 0u)
      {
        if (ssbo.data[GlobalInvocationID.x] > ssbo.data[ixj])
        {
          tmp = ssbo.data[GlobalInvocationID.x];
          ssbo.data[GlobalInvocationID.x] = ssbo.data[ixj];
          ssbo.data[ixj] = tmp;
        }
      }
      else
      {
        if (ssbo.data[GlobalInvocationID.x] < ssbo.data[ixj])
        {
          tmp = ssbo.data[GlobalInvocationID.x];
          ssbo.data[GlobalInvocationID.x] = ssbo.data[ixj];
          ssbo.data[ixj] = tmp;
        }
      }
    }
  }
  `;

  const gpuComputePipelineDescriptor2 = {
    module: device.createShaderModule({code: computeShaderWGSL2}),
    entryPoint: 'main',
  };

  computeUniformBindGroupLayout = device.createBindGroupLayout({
    entries: [{
      binding: 0,
      visibility: GPUShaderStage.COMPUTE,
      buffer: {
        type: GPUBufferBindingType.uniform,
        hasDynamicOffset: true
      }
    },
    ]
  });

  const computePipelineLayout2 = device.createPipelineLayout({
    bindGroupLayouts: [computeSSBOBindGroupLayout, computeUniformBindGroupLayout],
  });

  bitonicSortPipelne2 = device.createComputePipeline({
    layout: computePipelineLayout2,
    compute: gpuComputePipelineDescriptor2
  });

  // language=WGSL
  const computeShaderWGSL3 = `
  struct SSBO {
    data : array<f32>
  };
  @binding(0) @group(0) var<storage, read_write> ssbo : SSBO;

  struct Uniforms {
    numElements : vec4<u32>
  };
  @binding(0) @group(1) var<uniform> uniforms : Uniforms;

  var<workgroup> sharedData: array<f32, ${MAX_THREAD_NUM}>;

  @compute @workgroup_size(${MAX_THREAD_NUM}, 1, 1)
  fn main(
    @builtin(global_invocation_id) GlobalInvocationID : vec3<u32>,
    @builtin(local_invocation_index) LocallInvocationIndex : u32,
    @builtin(workgroup_id) WorkgroupID : vec3<u32>
  ) {
    sharedData[LocallInvocationIndex] = ssbo.data[GlobalInvocationID.x];
    workgroupBarrier();

    var offset:u32 = WorkgroupID.x * ${MAX_THREAD_NUM}u;

    var tmp:f32;
    for (var j:u32 = ${MAX_THREAD_NUM}u >> 1u; j > 0u; j = j >> 1u) {
      var ixj:u32 = (GlobalInvocationID.x ^ j) - offset;
      if (ixj > LocallInvocationIndex) {
        if ((GlobalInvocationID.x & uniforms.numElements.x) == 0u) {
          if (sharedData[LocallInvocationIndex] > sharedData[ixj]) {
            tmp = sharedData[LocallInvocationIndex];
            sharedData[LocallInvocationIndex] = sharedData[ixj];
            sharedData[ixj] = tmp;
          }
        }
        else
        {
          if (sharedData[LocallInvocationIndex] < sharedData[ixj]) {
            tmp = sharedData[LocallInvocationIndex];
            sharedData[LocallInvocationIndex] = sharedData[ixj];
            sharedData[ixj] = tmp;
          }
        }
      }
      workgroupBarrier();
    }

    ssbo.data[GlobalInvocationID.x] = sharedData[LocallInvocationIndex];
  }
  `;
  const gpuComputePipelineDescriptor3 = {
    module: device.createShaderModule({code: computeShaderWGSL3}),
    entryPoint: 'main',
  };

  bitonicSortPipelne3 = device.createComputePipeline({
    layout: computePipelineLayout2,
    compute: gpuComputePipelineDescriptor3
  });
};

const getLength = (index) => {
  return 1 << (index + 8);
};

const log = (str) => {
  logElement.innerText += str + '\n';
};

window.addEventListener('DOMContentLoaded', init);
