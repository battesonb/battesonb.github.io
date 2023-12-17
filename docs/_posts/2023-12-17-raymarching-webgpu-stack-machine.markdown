---
layout: post
title:  "Raymarching WebGPU Stack Machine"
date:   2023-12-17
categories: graphics
tags: webgpu
---

I've built something horrendous, so, naturally, I've decided to share it with
the world. For some background, you will need to be familiar with
raymarching[^1]. For a brief introduction, raymarching[^2] is a strategy for
rendering a scene of objects using rays cast from the camera/viewer's eye.
Raymarching, specifically, provides an optimization for taking as few steps as
possible.

It does this through the use of SDFs, which are essentially
composable mathematical functions that describe an object. Below is a quick
animation of this in action. The growing circles represent the evaluation of
this function which returns a distance to the nearest object (but not a
direction vector). This means our ray can safely "step" that distance without
colliding with any object in the scene. Notice how it slows down slightly as it
passes the rectangle. Without the rectangle, the ray could immediately jump to
the circle's radius.

<script src="/assets/raymarching-webgpu-stack-machine/raymarch.js"></script>
<canvas class="invertible" id="raymarch"></canvas>

A really powerful characteristic of these SDFs is that they can be composed with
set operations like union, intersection and subtraction. This is achieved with
the use of simple `min` and `max` functions. Not only that, but determining
shadows and doing other lighting calculations, even approximations, feels
significantly more straightforward and intuitive with ray marching than it does
in a regular scene with meshes.

## The horrendous idea

Now, I implemented a simple raymarching algorithm using WebGPU. This can
actually be achieved with only two triangles. Since all that's needed is a
fragment shader. I started by building the algorithm inside of the shader. That
means all objects, composition of objects and other visual traits were
hard-coded inside of the shader.

I thought to myself, "I could push this data from the CPU." The open question
was, "In what format?" I realized that I don't need anything more complicated
than a stack machine. These are easy to represent with an array, which perfectly
suits the limitations of GPU programming. So, I modelled a number of shapes and
commands that could be performed on those shapes. Of course, to add new shapes
and commands, I would have to update the shader to support these. What I send
from the CPU is just a data description of the shapes and commands.

There are some gotchas here, like the fact that you have to pad your structs on
16 byte boundaries. There's a really [nice
website](https://webgpufundamentals.org/webgpu/lessons/resources/wgsl-offset-computer.html)
for double-checking your padding. I also made it such that all shapes and
commands use the same amount of memory. In other words, every shape and command
is as big as the biggest shape and command, respectively. Overall, they're tiny
for what they represent, so I'm not worried.

For a taste of what this looks like, I drive all calls to fetching the data from
the stack through this `shape_sdf` function:

```rust
fn shape_sdf(p: vec3f, shape: Shape) -> Sdf {
  let color = shape.color;
  switch u32(shape.id) {
    case 0: { // composite
      return Sdf(shape.a, color);
    }
    case 1: { // box
      return Sdf(box(p - vec3f(shape.a, shape.b, shape.c), vec3f(shape.d, shape.e, shape.f)), color);
    }
    case 2: { // cylinder
      return Sdf(cylinder(p - vec3f(shape.a, shape.b, shape.c), shape.d, shape.e), color);
    }
    case 3: { // plane
      return Sdf(plane(p, vec3f(shape.a, shape.b, shape.c), shape.d), color);
    }
    case 4: { // sphere
      return Sdf(sphere(p - vec3f(shape.a, shape.b, shape.c), shape.d), color);
    }
    default: {
      return Sdf(MAX_DIST + EPSILON, color);
    }
  }
}
```

The virtual stack machine itself exists inside of the function for actually
evaluating the overall SDF. I've called it `scene`. I've modelled an accumulator
for easily emitting shapes which are just unioned. This wasn't necessary but it
felt easier for grouping logical "entities".

```rust
fn scene(p: vec3f) -> Sdf {
  let shape_count = i32(uniforms.shape_count);
  if (shape_count == 0) {
    default_sdf();
  }

  var acc = default_sdf();
  var stack_pointer: i32 = shape_count - 1;
  // a mutable variable representing the top of the stack, since we can't
  // modify the underlying array.
  var top_of_stack: Shape = shapes[stack_pointer];
  // Points to the second item on the stack (instead of the top).
  stack_pointer -= 1;
  let command_count = i32(uniforms.command_count);
  for (var i = 0; i < command_count; i++) {
    let command = commands[i];
    switch u32(command.id) {
      case 0: { // accumulate
        acc = sdf_min(acc, shape_sdf(p, top_of_stack));
        if (stack_pointer > 0) {
          top_of_stack = shapes[stack_pointer];
          stack_pointer -= 1;
        }
      }
      case 1: { // union
        top_of_stack = composite_shape(sdf_min(shape_sdf(p, top_of_stack), shape_sdf(p, shapes[stack_pointer])));
        stack_pointer -= 1;
      }
      case 2: { // intersection
        top_of_stack = composite_shape(sdf_max(shape_sdf(p, top_of_stack), shape_sdf(p, shapes[stack_pointer])));
        stack_pointer -= 1;
      }
      ...
      default: { // unknown
        return Sdf(0, vec3f(1, 1, 1));
      }
    }
  }
  return acc;
}
```

So, from the JavaScript side, I can just generate the data and operations as I
want:

```ts
shapes.push({
    type: ShapeType.Sphere,
    position: new Vec3(0, 0, 0),
    radius: 0.5,
});

shapes.push({
    type: ShapeType.Box,
    position: new Vec3(0.5, 0, 0),
    dimensions: Vec3f.fill(0.25),
});

commands.push({type: CommandType.Subtration});
commands.push({type: CommandType.Accumulate});
```

The above is a very imperative way of building up objects. It's not an issue,
and may be your preference, but there's also an option to generate these
commands from a more tree-like data structure which represents the composition
of an entity rather than how to build it. I stopped at the stack machine,
however.

For a visual, here's a video from the scene configured in the repository linked
below. The great thing is that these objects can be morphed, merged and sheared
in ways you could not easily achieve with meshes.

<div class="centered">
    <video muted autoplay controls style="width: 100%; max-width: 600px;">
        <source src="/assets/raymarching-webgpu-stack-machine/raymarched.webm" type="video/webm" />
    </video>
</div>

## Conclusion

This is a really interesting way of rendering a real-time scene in an
unconventional way. However, it's **slow**. With the current implementation, on
my computer, I can't have more than maybe 20 objects in the scene without
noticeable slowdown. I confirmed with a performance benchmark that it wasn't
actually the JavaScript causing the issue. JavaScript is only using roughly 1ms
of frame time, but I'm seeing frame drops of below 10 FPS (100 ms per frame).

Nevertheless, you could probably make an interesting game even with this
limitation. There's also nothing stopping one from composing a rasterized scene
with a raymarched one! One game in recent memory that does this is, "It Takes
Two," with its lava lamps.

## Links

* <https://github.com/battesonb/webgpu-raymarching>

## Footnotes

[^1]: Inigo Quilez's website is a treasure trove of information on this topic: <https://iquilezles.org/>.
[^2]: <https://en.wikipedia.org/wiki/Ray_marching>
