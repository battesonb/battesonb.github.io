---
layout: post
title:  "WebGPU game (#1): Boilerplate"
date:   2023-06-04
categories: graphics
tags: webgpu
---

I am setting out a journey to make a rudimentary game with WebGPU. My goal is to
create a very simple 3D [bullet hell](https://en.wikipedia.org/wiki/Bullet_hell)
game. It doesn't even have to be fun at the end! The real objective is to
encourage myself to write more and learn more in the open. I've spent some time
playing around with the [wgpu](https://wgpu.rs/) Rust library in the past (on
one of many abandoned hobby projects), so the API is not entirely new to me.

You can follow along if you'd like, but I'll often link out to a commit or the
Git tree at a given point if the diff is too big. There may also be fixes in
between posts, if (when) I've made a mistake. Just scan for `[fix]` tags in the
commit messages between posts.

I would not recommend these posts as a first introduction to a graphics API. I
would first recommend going through LearnOpenGL[^1] and the _Your first webgpu
app_ Google codelab[^2].

## Boilerplate

This project will only take on three dependencies (but, truly, none once built):

1. [TypeScript](https://www.typescriptlang.org/) -- For type safety, I prefer
   it! But it's not prescriptive, you can use JavaScript if you prefer.
2. [WebGPU types](https://www.npmjs.com/package/@webgpu/types) -- Type
   definitions for the WebGPU API.
3. [Vite](https://vitejs.dev/) -- For a no-nonsense bundler and webserver with
   hot-reloading.

First, get started with a blank vite project.

```sh
npm create vite@latest
```

I removed a bunch of the unused files and replaced the favicon with a WebGPU
SVG. Don't forget to add the WebGPU types as well.

```sh
npm i -D @webgpu/types
```

Add the following to your `vite-env.d.ts` file to include the type definitions.

```ts
/// <reference types="@webgpu/types" />
```

## Clearing the screen

WebGPU has a pretty daunting API, similar to Vulkan. With the caveat that it
also introduces a new shader language, [WGSL](https://www.w3.org/TR/WGSL/). This
immense API offers flexibility, but isn't friendly to newcomers when compared to
something like OpenGL & GLSL. This is a highly summarised version of the Google
codelab. Work through that for more detailed explanations.

First, I want to define a file called `assertions.ts` for making unrecoverable
error handling a bit easier. Inside this file we just have:

```ts
export function assertDefined<T>(value: T | null | undefined, message: string): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
}
```

It is purely a method for convincing the TypeScript compiler that a value is
defined after the assertion. If you are using JavaScript, just throw errors as
usual (basically the implementation of this method).

Now, make sure you have added a canvas to your HTML and a new CSS class to the
div:

```html
<!-- index.html -->
<body>
  <div class="container">
    <canvas width="768" height="768"></canvas>
  </div>
</body>
```

Add styles for a darker background and to center the canvas:

```css
/* style.css */

:root {
  color-scheme: light dark;
  background-color: #121212;
}

body {
  margin: 0;
  display: flex;
  place-items: center;
  width: 100%;
  min-height: 100vh;
}

div.container {
  margin: auto;
}
```

Now, we want to grab a reference to the canvas in the `main.ts` file.

```ts
// main.ts
const canvas = document.querySelector("canvas")!;
```

Next, we want to check whether WebGPU is supported on the browser. As of writing
this, very few platforms have support for WebGPU on stable browser releases.

```ts
assertDefined(navigator.gpu, "WebGPU is not supported on this browser");
```

We want to grab the `GPUAdapter` and `GPUDevice` from that adapter. The adapter
can be thought of as a reference to the GPU hardware, while the device is used
for the bulk of communication to the GPU.

```ts
const adapter = await navigator.gpu.requestAdapter();
assertDefined(adapter, "No appropriate GPUAdapter found");

const device = await adapter.requestDevice();
```

Next, similarly to how we grab the context for 2D or WebGL, we grab a WebGPU
context from the canvas. There is some minor configuration for the texture
format and a reference to the `GPUDevice`.

```ts
const context = canvas.getContext("webgpu")!;
const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
context.configure({
  device,
  format: canvasFormat,
});
```

The following encoder is created to submit the commands necessary to render
something to the screen. More generally, it can be used to send any workload to
the GPU[^3]. In our case, we'll focus on rendering.

```ts
const encoder = device.createCommandEncoder();
```

Now, we create a render pass and inform it to clear the canvas on each load
(before rendering). I like to put this in a scope because the pass should no
longer be used after calling `pass.end()`.

```ts
{
  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      storeOp: "store",
      clearValue: [0.54, 0.7, 1.0, 1.0],
      loadOp: "clear",
    }],
  });

  pass.end();
}
```

Finally, we create a buffer -- which encodes the render commands -- and submit
it to the GPU via a queue.

```ts
{
  const commandBuffer = encoder.finish();
  device.queue.submit([commandBuffer]);
}
```

You should end up with something like the following:

<div style="display: flex; justify-content: center;">
  <div style="display: block; width: 384px; height: 384px; background-color: rgb(54%, 70%, 100%);"></div>
</div>

## Links

1. [Git tree](https://github.com/battesonb/webgpu-blog-game/tree/437983db81370e3a1b3349e069d4ca08613c299f)

## Footnotes

[^1]: [LearnOpenGL](https://learnopengl.com)
[^2]: [Google codelab](https://codelabs.developers.google.com/your-first-webgpu-app)
[^3]: Alternatively, you could perform highly parallelized computations via
      compute shaders.
