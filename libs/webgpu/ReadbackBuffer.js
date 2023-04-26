const MAX_READ_BYTES = 2 << 18;

export class ReadbackBuffer {
  constructor(buffer) {
    this.buffer = buffer;
    this.numBuffers = Math.ceil(buffer.byteLength / MAX_READ_BYTES);
    this.unitByteLength = buffer.byteLength / this.numBuffers;
    this.offsetElementLength = this.unitByteLength / this.buffer.BYTES_PER_ELEMENT;
    this.unitBufferList = [];
  }

  createBuffer(device) {
    const gpuBufferDescriptor = {
      size: this.unitByteLength,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    };
    for (let i = 0; i < this.numBuffers; i++) {
      this.unitBufferList[i] = device.createBuffer(gpuBufferDescriptor);
    }
  }

  copyBufferToBuffer(commandEncoder, src, srcOffset = 0) {
    for (let i = 0; i < this.numBuffers; i++) {
      commandEncoder.copyBufferToBuffer(src, srcOffset + this.unitByteLength * i, this.unitBufferList[i], 0, this.unitByteLength);
    }
  }

  async mapReadAsync() {
    for (let i = 0; i < this.numBuffers; i++) {
      const readbackBuffer = this.unitBufferList[i];
      readbackBuffer.mapAsync
          ? await readbackBuffer.mapAsync(GPUMapMode.READ).then(() => this.buffer.set(new this.buffer.constructor(readbackBuffer.getMappedRange()), this.offsetElementLength * i))
          : await readbackBuffer.mapReadAsync().then(arrayBuffer => this.buffer.set(new this.buffer.constructor(arrayBuffer), this.offsetElementLength * i));
    }
  }

  destroy() {
    for (let i = 0; i < this.numBuffers; i++) {
      this.unitBufferList[i].destroy();
    }
    this.unitBufferList = null;
    this.buffer = null;
  }
}