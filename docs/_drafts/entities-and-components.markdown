---
layout: post
title:  "WebGPU game (#6): Entities and Components"
series: "WebGPU game"
categories: graphics
tags: webgpu
---

As mentioned in the [previous post]({% post_url
2023-07-11-webgpu-game-5-player-look-at %}), we have a lot of duplicate code.
The cube and player are mostly identical except for their vertices. The player
has additional functionality to face the camera.

## Motivation

I want to be able to make additions that effect various logical entities in the
game, and I want to be able to make changes without making changes in many
sections of the code.

From these requirements, we can conclude that we want to compose entities from a
number of basic reusable building blocks. In other words we want to model a
"has-a" rather than the more rigid "is-a" relationship for our entities[^1].

I've opted to model entities as nothing more than a unique name. That is all
they are. In some existing implementations this is a random or incremented
unique ID. However, I want to be able to reference entities cheaply by name. An
alternative option here is to use numbers[^2] to make the internal hashing
cheaper, but I'm opting for this easy readable lookup until it becomes a
problem.

So, we need a way to attach data to our entities. I've used the name `Component`
to describe these bags of data.

Finally, we need some way to operate on one or many components at a time. The
two approaches that I've come across include either modelling these behaviours
as separate "systems" or just making the components responsible for performing
updates to themselves and other components. I've opted for the latter approach,
as you can simply model components without data that just operate on other
components to get a drop-in equivalent for systems. Every component will be able
to implement lifecycle methods to achieve these behaviours.

## Existing solutions

What I've described is an Entity-Component architecture (or EC). Some existing
frameworks that have this architecture include
[Unity](https://docs.unity3d.com/Manual/GameObjects.html), with its GameObject
abstraction, and [Nez](https://github.com/prime31/Nez). Implementations differ,
but the core idea is the same. There is some actor/entity/game object which
serves as an identifier for something that exists in your game world. You attach
components to give it visual features and behaviours.

This is in contrast with another similar architecture known as an
Entity-Component-System, as alluded to in the motivation above. An ECS is
generally capable of squeezing out more performance than an EC at their limits.
For a brief description, an ECS would generally store components in structures
of arrays[^3]. This allows for improved cache-locality and the opportunity to
take advantage of SIMD instructions. Additionally, the system abstraction can be
written in such a way that the ECS performs updates to components in parallel
based on component query patterns. Examples of frameworks implementing an ECS
architecture include [Unity's DOTS](https://unity.com/dots) framework and the
[Bevy](https://bevyengine.org/learn/book/getting-started/ecs/) game engine.

Overall, we're using JavaScript. Parallelism does not apply and the game we're
making is incredibly simple, so I'm opting for a straightforward EC
architecture.

## Implementation

For this post, I'm only going to describe the changes that relate to
implementing the EC architecture. Otherwise, this post would include a lot of
refactoring that is otherwise not related to the topic. Feel free to look at the
[diff](https://github.com/battesonb/webgpu-blog-game/commit/3cae1e543a7e5d6feef1a7969ddffb8283b235fe)
for the full detail.

TODO the rest

### Resources

Resources function as singleton components. While we could manage the same
functionality with entities and components, this helps enforce the rule of only
one resource at an API level.

TODO place this correctly

## Links

1. [Git tree](https://github.com/battesonb/webgpu-blog-game/tree/3cae1e543a7e5d6feef1a7969ddffb8283b235fe)

## Footnotes

[^1]: In other words, we're using [composition](https://en.wikipedia.org/wiki/Inheritance_(object-oriented_programming)).
[^2]: Perhaps a tuple for entity archetype and generation -- that way you have fast retrieval and an abstraction of how the IDs are kept unique.
[^3]: <https://en.wikipedia.org/wiki/AoS_and_SoA>
