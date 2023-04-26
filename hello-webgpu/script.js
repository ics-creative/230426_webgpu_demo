import {GPULoadOp, GPUPrimitiveTopology, GPUStoreOp,} from "../libs/webgpu/GPUEnum.js";

async function init() {
  // アダプターを取得
  const adapter = await navigator.gpu?.requestAdapter();
  // アダプターからデバイスを取得
  const device = await adapter?.requestDevice({});

  // キャンバスのセットアップ
  const canvas = document.getElementById('myCanvas');
  canvas.width = canvas.style.width = innerWidth;
  canvas.height = canvas.style.height = innerHeight;

  // キャンバスから描画コンテキストを取得
  const context = canvas.getContext('webgpu');

  if (!adapter || !device || !context) {
    notSupportedDescription.style.display = "block";
    canvas.style.display = "none";
    return;
  }
  notSupportedDescription.style.display = "none";
  canvas.style.display = "inline";

  // 適切なスワップチェーンフォーマットを取得
  const swapChainFormat = navigator.gpu.getPreferredCanvasFormat();

  // コンテキストにデバイスとスワップチェーンフォーマットを設定
  const swapChain = context.configure({
    device: device,
    format: swapChainFormat
  });

  // language=WGSL
  const vertexShaderWGSL = `
  // 頂点シェーダのWGSLコード
  @vertex
  fn main(
    @builtin(vertex_index) VertexIndex : u32
  ) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2(0.0, 0.5),
    vec2(-0.5, -0.5),
    vec2(0.5, -0.5)
  );
  return vec4<f32>(pos[VertexIndex], 0.0, 1.0);
  }
  `;
  // 頂点シェーダーのコンパイル
  const gpuVertexState = {
    module: device.createShaderModule({code: vertexShaderWGSL}),
    entryPoint: "main"
  }
  if (gpuVertexState.module.compilationInfo) {
    // シェーダーコンパイルのエラーチェック
    console.log(await gpuVertexState.module.compilationInfo());
  }

  // language=WGSL
  const fragmentShaderWGSL = `
  // フラグメントシェーダのWGSLコード
  @fragment
  fn main() -> @location(0) vec4<f32> {
    return vec4(1.0, 0.0, 0.0, 1.0);
  }
  `;
  // フラグメントシェーダーのコンパイル
  const gpuFragmentState = {
    module: device.createShaderModule({code: fragmentShaderWGSL}),
    entryPoint: "main"
  }
  if (gpuVertexState.module.compilationInfo) {
    // シェーダーコンパイルのエラーチェック
    console.log(await gpuFragmentState.module.compilationInfo());
  }

  // レンダリング用パイプラインの設定ディスクリプタ（記述子）をオブジェクト形式で定義
  const gpuRenderPipelineDescriptor = {
    // 定数のレイアウトを指定。今回のシェーダーでは定数はなし。"auto"を指定するとシェーダーから適切なバインドグループレイアウトを自動で作成してくれる。
    layout: "auto",

    // 頂点シェーダーステージの設定
    vertex: gpuVertexState,

    // フラグメントシェーダーステージの設定
    fragment: Object.assign(gpuFragmentState, {
      // 描画対象のフォーマット
      targets: [{
        format: swapChainFormat
      }]
    }),

    // 描画するプリミティブ（点や三角形）の設定
    primitive: {
      topology: GPUPrimitiveTopology.triangle_list
    }
  };

  // ディスクリプタからパイプラインを作成。
  const pipeline = device.createRenderPipeline(gpuRenderPipelineDescriptor);

  // レンダリング設定のディスクリプタをオブジェクト形式で定義
  const renderPassDescriptor = {
    colorAttachments: [{
      clearValue: {r: 0.3, g: 0.6, b: 0.8, a: 1.0},
      loadOp: GPULoadOp.clear,
      storeOp: GPUStoreOp.store,
      view: undefined,
    }]
  };

  // 三角形をレンダリング
  // GPUコマンド列を作成
  const commandEncoder = device.createCommandEncoder({});

  // レンダリング設定のディスクリプタに、描画対象キャンバスのテクスチャビューを設定。これはレンダリングのたびに実行する必要がある。
  renderPassDescriptor.colorAttachments[0].view = context.getCurrentTexture().createView();

  // レンダリングコマンドを作成
  const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
  // 使用するパイプラインを指定
  passEncoder.setPipeline(pipeline);
  // ドローコール。3頂点を1インスタンス。
  passEncoder.draw(3, 1, 0, 0);
  // レンダリングコマンドを終了
  passEncoder.end();

  // コマンドをGPUキューに追加
  device.queue.submit([commandEncoder.finish()]);
}

window.addEventListener('DOMContentLoaded', init);
