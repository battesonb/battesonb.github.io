---
layout: post
title:  "WebGPU game (#5): Player Look-At"
series: "WebGPU game"
date:   2023-07-11
categories: graphics
tags: webgpu
---

Today's post is quite minimal in terms of what we achieve, but there's a lot of
implementation detail that needs to be covered. The goal of this post is to
display the player character as a flat plane that always looks at the camera (or
is perpendicular to the viewing direction of the camera).

<div class="centered margin">
{% pgf viewing angle %}
  %% camera
  \draw (0, 0) -- (1, 0) -- (1, 1) -- (0, 1) -- cycle;
  \draw (1, 1) -- (1.5, 1.5) -- (1.5, -0.5) node[anchor=north east] {camera} -- (1, 0);

  \draw[dashed] (1.5, 0.5) -- (5, 0.5);

  \draw (5, 0) node[anchor=north] {player} -- (5, 1);

  \begin{scope}[rotate around z=-25,shift={(7,5,0)}]
    %% camera
    \draw (0, 0) -- (1, 0) -- (1, 1) -- (0, 1) -- cycle;
    \draw (1, 1) -- (1.5, 1.5) -- (1.5, -0.5) node[anchor=north east] {camera} -- (1, 0);

    \draw[dashed] (1.5, 0.5) -- (5, 0.5);

    \draw (5, 0) node[anchor=north] {player} -- (5, 1);
  \end{scope}
{% endpgf %}
</div>

This is commonly referred to as a *billboard sprite*. There are a number of ways
to achieve this effect. For dedicated graphics cards, the cheapest is likely to
perform the transformation with a shader for specific entities in the world. I'm
going to perform this transformation on the CPU for ease and clarity (perhaps
we'll revisit this).

If you've gone through the [3D projection]({% post_url
2023-06-21-3d-projection-intro-model-and-view %}) series, you may want to pause
and consider how we could achieve a model transform that always looks at the
camera. If you thought "a change of basis" you're right[^1]!

## Maintenance

Firstly, a noticeable error will pop up if we don't fix a missing normalization
in the camera's own change of basis! Feel free to defer this to the end to see
how it effects everything else. Add the following methods to the `Vec3` class:

```ts
div(scalar: number): Vec3 {
  return new Vec3(this.x / scalar, this.y / scalar, this.z / scalar);
}

magnitudeSquared(): number {
  return this.x * this.x + this.y * this.y + this.z * this.z;
}

magnitude(): number {
  return Math.sqrt(this.magnitudeSquared());
}

normal(): Vec3 {
  return this.div(this.magnitude());
}
```

Then update the camera's view matrix:

```ts
export class Camera {
  ...
  matrix(): Mat4 {
    const e = this.position;
    const d = this.dir();
    const r = d.cross(new Vec3(0, 1, 0)).normal(); // updated
    const u = r.cross(d).normal(); // likely not necessary
    ...
  }
  ...
}
```

The issue is that the direction and (specified) up vector are not necessarily
perpendicular, so the resulting magnitude is not necessarily one. Recall that,
for a change of basis, our vectors need to be orthogonal **unit** vectors.

$$
|\vec{a}\times\vec{b}| = |\vec{a}||\vec{b}|\sin{\theta}
$$

Next, I want to update all occurrences of the following variables with new
names. Use your editor's functionality to rename symbols if possible!

```ts
cube -> cubeDesc
vertices -> cubeVertices
vertexBuffer -> cubeVertexBuffer
indexBuffer -> cubeIndexBuffer
instance -> cubeInstance
instanceBuffer -> cubeInstanceBuffer
```

This allows us see the similarities for the two entities, even though they won't
have the same functionality at the end. The cube will be used as a building
block for the terrain and the player will be a building block for all billboard
sprites. Even then, the player will differ from the enemies and bullets which
are all billboard sprites.

## Adding the player

For the player, we start with the vertex descriptors:

```ts
const playerDesc = [
  [-0.5, -0.5, 0, 0.0, 1.0, 6],
  [0.5, -0.5, 0, 1.0, 1.0, 6],
  [0.5, 0.5, 0, 1.0, 0.0, 6],
  [-0.5, 0.5, 0, 0.0, 0.0, 6],
];
```

We then setup the vertex and index buffers as we did for the cube, previously:

```ts
const playerVertices = new Float32Array(playerDesc.map(values => {
  return [values[0], values[1], values[2], ...uvFromIndex(values[5], values[3], values[4], texture)];
}).flat());

const playerVertexBuffer = device.createBuffer({
  label: "player vertex buffer",
  size: playerVertices.buffer.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
});

device.queue.writeBuffer(playerVertexBuffer, 0, playerVertices);

const playerPlanes = playerDesc.length / 4;
const playerIndices = new Uint32Array(Array.from({length: playerPlanes}).map((_, i) => ([
  0, 1, 2, 0, 2, 3
]).map(x => x + i * 4)).flat());

const playerIndexBuffer = device.createBuffer({
  label: "player index buffer",
  size: playerIndices.buffer.byteLength,
  usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});

const playerInstance = new Float32Array(Mat4.identity().buffer());

const playerInstanceBuffer = device.createBuffer({
  label: "player instance buffer",
  size: playerInstance.buffer.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});

device.queue.writeBuffer(playerInstanceBuffer, 0, playerInstance);
```

You're likely already screaming internally (or externally!) about all the
repetition. I like to go through the process of writing the unwieldy code before
DRYing[^2] everything. Particularly, I want to make sure to pick an abstraction
that resolves my problem. I'll get into this in the next post, so I'll leave it
there for now.

Next, we want to render the player. I've put the commands for rendering the
entities in separate scopes just for my own benefit:

```ts
{
  // cube bindings
}
{
  pass.setVertexBuffer(0, playerVertexBuffer);
  pass.setVertexBuffer(1, playerInstanceBuffer);
  pass.setIndexBuffer(playerIndexBuffer, "uint32");
  pass.drawIndexed(playerIndices.length, 1);
}
```

If you look over to your WebGPU application in the browser, you should see
nothing but the same old cube spinning about. The player is actually inside the
cube, let's put the player on top using its model matrix. Inside our `mat4.ts`
file add a method for obtaining a translation matrix:

```ts
static translated(value: Vec3): Mat4 {
  return new Mat4(
    1, 0, 0, value.x,
    0, 1, 0, value.y,
    0, 0, 1, value.z,
    0, 0, 0, 1,
  );
}
```

Update the player's model matrix to offset the player:

```ts
const playerInstance = new Float32Array(
  Mat4.translated(new Vec3(0, 1, 0)).buffer());
);
```

And also update the fragment shader to drop any pixels that are transparent:

```rust
if (color.a == 0) {
  discard; // keyword to completely disregard this fragment and return
}
return color;
```

![Player rotating with cube](/assets/webgpu-game-5-player-look-at/player-rotating.png)

## Look at me

You'll notice the player rotates with the cube. We want the player to look at
the camera at all times. Let's implement another static method in our `mat4.ts`
file to create a "look-at" matrix.

```ts
/**
 * A method for defining a "look-at" matrix for a given position and target in
 * a right-handed coordinate system.
 *
 * This makes use of a change of basis.
 */
static lookAt(eye: Vec3, target: Vec3, up = Vec3.unit_y()): Mat4 {
  const k = target.sub(eye).normal();
  const i = up.cross(k).normal();
  const j = k.cross(i).normal();
  return new Mat4(
    i.x, j.x, k.x, 0,
    i.y, j.y, k.y, 0,
    i.z, j.z, k.z, 0,
      0,   0,   0, 1,
  );
}
```

I did not have to normalize the $$j$$ vector, but I don't trust floating-point
precision, so I've done it anyway! Make sure that the above makes sense to you.
Try and reframe the old $$z$$-axis such that it points to the target vector, and
build the new $$x$$- and $$y$$-axes using the right-hand rule with the cross
product. I've also hallucinated a method for our `Vec3` class, so add it if you
haven't already:

```ts
sub(other: Vec3): Vec3 {
  return new Vec3(this.x - other.x, this.y - other.y, this.z - other.z);
}
```

For our final matrix, we are going to want to scale, translate and rotate the
player. We are missing a method to scale the player, so add the following to
your `Mat4` class:

```ts
static scaled(value: Vec3): Mat4 {
  return new Mat4(
    value.x,       0,       0, 0,
          0, value.y,       0, 0,
          0,       0, value.z, 0,
          0,       0,       0, 1,
  );
}
```

As a nice helper, I've also added the following to `Vec3.ts`:

```ts
static fill(scalar: number): Vec3 {
  return new Vec3(scalar, scalar, scalar);
}
```

Now, lastly, you will have to update the player's instance buffer every frame,
so add the following inside the event loop:

```ts
function eventLoop() {
  ...
  const playerInstance = new Float32Array(
    Mat4.translated(new Vec3(0, 1, 0))
      .mul(Mat4.scaled(Vec3.fill(0.8)))
      .mul(Mat4
        .lookAt(Vec3.zero(), camera.position))
      .buffer()
  );
  device.queue.writeBuffer(playerInstanceBuffer, 0, playerInstance);
  ...
}
```

This essentially sets up the player's transform to first rotate it relative to
its own origin to face the camera, scale it down slightly, and then translate it
to be above the ground. It is common to move the translation last (or to the
left-most part of the matrix multiplication) to avoid rotating about an offset
position.

![Complete player sprite](/assets/webgpu-game-5-player-look-at/complete-player.png)

As usual, I recommend removing some matrices temporarily (or moving the player
instance matrix outside of the event loop to see how it looks from other angles
when it's set to "look at" the camera). Just remember to put it all back!

## What is that flickering?

On occasion, you may see that the player has a distinct line on the left of the
quad. This is because the atlas is packed together tightly. Occasionally, due to
floating-point rounding errors, part of the pixel on the left of the player in
the atlas is sampled. A simple solution to this is to add a transparent single
pixel column between each sprite and update the `uvFromIndex` method in
`texture.ts` as follows:

```ts
const TILE_SIZE = 8;
const PADDING = 1;
export function uvFromIndex(index: number, x: number, y: number, texture: GPUTexture): [number, number] {
  // updated
  const i = ((index * (TILE_SIZE + PADDING)) % texture.width) / texture.width;
  return [i + (x * TILE_SIZE) / texture.width, y * TILE_SIZE / texture.height];
}
```

## Links

* [Git tree](https://github.com/battesonb/webgpu-blog-game/tree/c244eabea3ee1bd5089a1a55ef1a37e5828a40a5)

## Footnotes

[^1]: Well, you're right that I've chosen to completely side-step talking about Quaternions.
[^2]: I go through the WET process first, also mentioned in the Wikipedia article: <https://en.wikipedia.org/wiki/Don%27t_repeat_yourself>.
