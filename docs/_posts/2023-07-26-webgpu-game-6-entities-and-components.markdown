---
layout: post
title:  "WebGPU game (#6): Entities and Components"
series: "WebGPU game"
date:   2023-07-26
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
cheaper, but I'm opting for this easy readable lookup until/if it becomes a
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

For a very simple relationship diagram, we have the following:

<div class="centered margin">
{% pgf er diagram %}
  \node[circle,minimum size=2.5cm,draw=black] (W) {World};
  \node[circle,minimum size=2.5cm,draw=black,right=3cm of W] (E) {Entity};
  \node[circle,minimum size=2.5cm,draw=black,right=3cm of E] (C) {Component};
  \node[circle,minimum size=2.5cm,draw=black,below=2cm of W] (R) {Resource};

  \draw[-latex] (W) -- (E) node[midway,above] {has many};
  \draw[-latex] (E) -- (C) node[midway,above] {has many};
  \draw[-latex] (W) -- (R) node[midway,right] {has many};
{% endpgf %}
</div>

The world is simply the container for all of our entities and resources. If we
wanted to introduce a main menu, I'd perhaps add a `Scene` type between the
world and entities, but this simpler layout suits my purposes.

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
For a brief description, an ECS would generally (but not necessarily) store
components in structures of arrays[^3]. This allows for improved cache-locality
and the opportunity to take advantage of SIMD instructions. Additionally, the
system abstraction can be written in such a way that the ECS performs updates to
components in parallel based on component query patterns. Examples of frameworks
implementing an ECS architecture include [Unity's DOTS](https://unity.com/dots)
framework and the [Bevy](https://bevyengine.org/learn/book/getting-started/ecs/)
game engine.

Overall, we're using JavaScript. Parallelism does not apply and the game we're
making is incredibly simple, so I'm opting for a straightforward EC
architecture.

## Implementation

For this post, I'm only going to describe the changes that relate to
implementing the EC architecture. Otherwise, this post would include a lot of
refactoring that is otherwise not related to the topic. Feel free to look at the
[diff](https://github.com/battesonb/webgpu-blog-game/commit/3cae1e543a7e5d6feef1a7969ddffb8283b235fe)
for the full detail.

### High-level overview

Let's first define the files we want with empty implementations. That way I can
describe the implementations while still keeping things (mostly) compiling.

```sh
├── src
    ├── ecs
        ├── component.ts
        ├── entity.ts
        ├── resource.ts
        └── world.ts
```

Inside the files, add the following empty classes:

```ts
// component.ts
export abstract class Component {}

// entity.ts
export class Entity {}

// world.ts
export class World {}

// resource.ts
export abstract class Resource {}
```

### Components

At the lowest level of the hierarchy, we have the component. This is modelled as
an abstract class so that we can implement some default members and methods. We
first define some interfaces for lifecycle methods. These lifecycle methods
provide each component the opportunity to make changes to themselves, other
components and even components of other entities. The interfaces provide the
components with access to a limited number of elements outside of their scope,
such as the world they belong in and the amount of time that has passed since
the previous frame.

```ts
export interface InitContext {
  world: World,
}

export interface UpdateContext {
  dt: number,
  now: number,
  world: World,
}

export interface RenderContext {
  pass: GPURenderPassEncoder,
  dt: number,
}
```

Next we have the method definitions for the component. The type signature for
the `getComponent` method is quite daunting, but it just means we only want
types whose constructor produces a generic type `T` that implements the
`Component` type.

This is a handy helper method for obtaining components
belonging to the same parent entity. Otherwise, we just have our attribute
accessors for the owning entity and the empty lifecycle methods.

```ts
export abstract class Component {
  private _entity?: Entity;

  getComponent<T extends Component>(
    type: { new(...args: any[]): T }
  ): T | undefined {
    return this._entity?.getComponent(type);
  }

  get entity(): Entity {
    return this._entity!
  }

  set entity(value: Entity) {
    this._entity = value;
  }

  /**
   * Performed once for this component when its parent entity is added to the world
   */
  init(_ctx: InitContext) {}

  /**
   * Runs every frame.
   */
  update(_ctx: UpdateContext) {}

  /**
   * Runs every frame after update -- should only be used for rendering.
   */
  render(_ctx: RenderContext) {}
}
```

At the bottom of this file, we have to define a method for identifying the
different component types. We will use this identifier to map the type of a
component to its implementation, so that we can fetch components by their class
type.

As far as I understand, there isn't sufficient reflection functionality in
JavaScript to identify class types as of writing this post. First, we alias the
ID with a number:

```ts
export type ComponentId = number;
```

Next, we want to create a unique identifier for the class of each component. So,
we commit some TypeScript crimes[^4] and use an immediately-evaluated function
whose closure includes a method-private state variable. I could have kept the
value outside of the function and just not exported it from this module, but I
wanted to keep its purpose clear. Essentially, we attach a component ID to a
provided class if it does not already exist, and then we return the value
attached to the class. We can do this because of the assumption that JavaScript
is single-threaded. A method like this would not be considered thread-safe in
many other environments.

```ts
export const getComponentId = (() => {
  let nextComponentId = 0;

  return <T extends Component>(type: { new(...args: any[]): T }): ComponentId => {
    // @ts-ignore
    if (type._componentId === undefined) {
      // @ts-ignore
      type._componentId = nextComponentId++;
    }
    // @ts-ignore
    return type._componentId;
    };
})();
```

### Entities

Entities have a relatively straightforward implementation. They hold onto a map
of components (from their `ComponentId`) and they have a name as a unique
identifier. We make use of a fluent interface[^5] to chain adding components to
an entity (`withComponent` and `withComponentDefault`). The default
implementation exists in the case that a component has an empty constructor just
for a nicer API.

You'll notice that the `withComponent` implementation uses a TypeScript `as`
escape-hatch. Unfortunately, in this case, TypeScript is not aware that the
prototype of the component matches the provided type signature. I have confirmed
that this works at runtime -- in practice, a test against your targeted browser
versions would suffice as validation.

```ts
export class Entity {
  private _components: Map<ComponentId, Component>;
  private _name: string;

  constructor(name: string) {
    this._components = new Map();
    this._name = name;
  }

  get name() {
    return this._name;
  }

  get components(): IterableIterator<Component> {
    return this._components.values();
  }

  withComponentDefault<T extends Component>(type: { new(): T }): Entity {
    const component = new type();
    return this.withComponent(component);
  }

  withComponent<T extends Component>(component: T): Entity {
    component.entity = this;
    this._components.set(
      getComponentId(component.constructor as { new(...args: any[]): T } ),
      component
    );
    return this;
  }

  getComponent<T extends Component>(type: { new(): T }): T | undefined {
    const component = this._components.get(getComponentId(type));
    if (component) {
      return component as T;
    }
    return undefined;
  }
}
```

### Resources

Resources function as singleton components. While we could manage the same
functionality with entities and components, this helps enforce the rule of only
one resource at an API level. The class only has one lifecycle method for now,
however that's likely to change as the need arises.

```ts
export abstract class Resource {
  /**
   * Performed on cleanup of the world.
   */
  destroy() {}
}
```

Resources also need a unique ID. I'm not going to define that here but you can
essentially do a find and replace for `ComponentId` with `ResourceId`.

### World

Finally, we have the world to link it all up. I'm going to break this class
definition up into different areas of concern. First, we have the entities and
resources stored in maps by unique name and `ResourceId`, respectively. We also
have a list of new entities so that we can initiate the `init` lifecycle method
for all components on the new entities at the start of the next frame.

```ts
export class World {
  private _newEntities: Entity[];
  private _entities: Map<string, Entity>;
  private _resources: Map<ResourceId, Resource>;

  constructor() {
    this._newEntities = [];
    this._entities = new Map();
    this._resources = new Map();
  }
}
```

We then add methods for adding and obtaining resources from the world. Again,
relying on a fluent interface. You'll note that adding a resource of the same
type simply replaces the previous version. This is a viable strategy for
updating resources that don't maintain some context across frames.

```ts
export class World {
  ...

  withResourceDefault<T extends Resource>(type: { new(): T }): World {
    const resource = new type();
    return this.withResource(resource);
  }

  withResource<T extends Resource>(resource: T): World {
    this._resources.set(
      getResourceId(resource.constructor as { new(...args: any[]): T }),
      resource
    );
    return this;
  }

  getResource<T extends Resource>(
    type: { new(...args: any[]): T }
  ): T | undefined {
    const component = this._resources.get(getResourceId(type));
    if (component) {
      return component as T;
    }
    return undefined;
  }
}
```

Lastly, we have the entity-related methods. We have some basic insertion and
retrieval methods and finally the drivers for the lifecycle methods. Note how
the `World#update` method drives both the `init` lifecycle hook and the `update`
lifecyle hook. I've separated out the `render` method, even though it is
entirely viable that rendering is made to simply be managed by the EC paradigm
itself. This is just a matter of taste and ease of implementation. Feel free to
deviate if you'd like to take on this challenge.

```ts
export class World {
  ...

  addEntities(...entities: Entity[]) {
    this._newEntities.push(...entities);
  }

  getByName(name: string): Entity | undefined {
    return this._entities.get(name);
  }

  update(ctx: UpdateContext) {
    for (const entity of this._newEntities) {
      assert(
        !this._entities.has(entity.name),
        `Tried to add an entity with the same name to the world: ${entity.name}`
      );
      this._entities.set(entity.name, entity);
    }

    for (const entity of this._newEntities) {
      for (const component of entity.components) {
        component.init({world: ctx.world});
      }
    }

    this._newEntities.splice(0);

    for (const entity of this._entities.values()) {
      for (const component of entity.components) {
        component.update(ctx);
      }
    }
  }

  render(ctx: RenderContext) {
    for (const entity of this._entities.values()) {
      for (const component of entity.components) {
        component.render(ctx);
      }
    }
  }
}
```

## Putting it all together

I'm going to defer the refactoring of current behaviours into components to the
diff itself, as mentioned at the beginning of the post. But let's look at a
small component implementation:

```ts
// components/billboard.ts
export class Billboard extends Component {
  init(_ctx: InitContext): void {
    const transform = this.getComponent(Transform)!;
    // billboards appear larger than their surrounds, so this is just
    // to combat that issue.
    transform.scale = Vec3.fill(0.8);
  }

  update(ctx: UpdateContext): void {
    const {world} = ctx;
    const transform = this.getComponent(Transform)!;
    const camera = world.getByName("camera")!;
    const cameraComponent = camera.getComponent(Camera)!;
    transform.rotation = Mat4.lookAt(Vec3.zero(), cameraComponent.dir().neg());
  }
}
```

You surrender some type safety for the flexibility offered by the EC. It's
entirely possible to implement a higher-level abstraction to avoid runtime
errors, but this only aids in hiding a logical error. I think the noisy failure
is best suited for quick iteration. You can always use asserts with messages
instead of using the `!` operator for more clarity.

Now, let's look at the definition of the player entity:

```ts
// entities/player.ts
export function plane(texture: GPUTexture, index: number) {
  return [
    new Vertex(new Vec3(-0.5, -0.5, 0.5), uvFromIndex(index, 0.0, 1.0, texture)),
    new Vertex(new Vec3(0.5, -0.5, 0.5), uvFromIndex(index, 1.0, 1.0, texture)),
    new Vertex(new Vec3(0.5, 0.5, 0.5), uvFromIndex(index, 1.0, 0.0, texture)),
    new Vertex(new Vec3(-0.5, 0.5, 0.5), uvFromIndex(index, 0.0, 0.0, texture)),
  ];
}

export function newPlayer(world: World): Entity {
  const transform = new Transform();
  transform.position.y = 1;
  const texture = world.getResource(GpuResources)!.texture;
  return new Entity("player")
    .withComponent(transform)
    .withComponentDefault(Billboard)
    .withComponent(new Mesh(plane(texture, 6)));
}
```

If you remove the `Billboard` component, for example, the player will just lose
the functionality to face the camera but otherwise render as expected. This is
very powerful, and you can note the reuse of components across the three current
entities in our game world (camera, player and terrain/cube).

Many of the components in this section are just refactors of the code described
in previous posts, so I'm going to end the post here. However, the mechanics of
these changes are worth going through. Note how little the `Camera` class
changes, while the `Mesh` is a whole new component. Note how the `Camera` class
lost the need to manage its own position, as we have another component that
suits this role, the `Transform`. However, the scale and rotation of the
transform do nothing to the camera's behaviour, so perhaps it's a bad
abstraction or we should rely on the transform more.

## Links

1. [Git tree](https://github.com/battesonb/webgpu-blog-game/tree/3cae1e543a7e5d6feef1a7969ddffb8283b235fe)

## Footnotes

[^1]: In other words, we're using [composition](https://en.wikipedia.org/wiki/Inheritance_(object-oriented_programming)).
[^2]: Perhaps a tuple for entity archetype and generation -- that way you have fast retrieval and an abstraction of how the IDs are kept unique.
[^3]: <https://en.wikipedia.org/wiki/AoS_and_SoA>
[^4]: If you're writing this in plain JavaScript, the crime would have no evidence.
[^5]: <https://en.wikipedia.org/wiki/Fluent_interface>
