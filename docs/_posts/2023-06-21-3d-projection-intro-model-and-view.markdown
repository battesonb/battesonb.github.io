---
layout: post
title:  "3D Projection: Introduction, Model and View"
series: "3D projection"
date:   2023-06-21
categories: graphics
tags: [linear algebra]
---

{% include mathjax.html %}

I have to pause the WebGPU posts to derive a series of transformations that will
get us from 3D space to a 2D image on the screen. I will be assuming an
understanding of basic linear algebra, but I'll try to simplify, link out or
explain all of my assumptions.

## Background

Firstly, we need to consider that a vertex is usually specified relative to a
local model/mesh position. We then need to hold onto a transform specifying
where that model exists in the world. We also need a camera which specifies
which part of the world we are currently observing.

Lastly, we have to project this view of the world onto a cube. The end goal is
to get the coordinates of this cube within the following ranges[^1]:

$$
  x \in [-1, 1] \\
  y \in [-1, 1] \\
  z \in [0, 1]
$$

These normalized device coordinates (NDC) differ across convention, handedness
and graphics API. For some (usually right-handed), $$y$$ points downwards! I'm
not going to enumerate these, but rather show how this cube is mapped to our
screen in WebGPU. The side we are facing is coloured blue, as we are looking
down the z-axis.

<div class="centered margin">
{% pgf coordinate system %}
  \tikzmath{
    \x = 3;
    \y = 3;
    \z = 3;
  }
  %% axis lines
  \draw[black!10!red,-latex] (0, 0, \z) -- ++(1, 0, 0) node[anchor=west] {$x$};
  \draw[black!50!green,-latex] (0, 0, \z) -- ++(0, 1, 0) node[anchor=south] {$y$};
  \draw[black!10!blue,-latex] (0, 0, \z) -- ++(0, 0, -1) node[anchor=south west] {$z$};

  %% back
  \draw (-\x, -\y, 0) -- ++(2*\x,0,0) -- ++(0,2*\y,0) -- ++(-2*\x,0,0) -- cycle;

  %% front
  \draw[black,fill=cyan,fill opacity=0.1] (-\x, -\y, \z) -- ++(2*\x,0,0) -- ++(0,2*\y,0) -- ++(-2*\x,0,0) -- cycle;

  %% connections
  \draw (\x, \y, 0) node[anchor=south west] {$(1, 1, 1)$} -- ++(0, 0, \z);
  \draw (-\x, \y, 0) -- ++(0, 0, \z);
  \draw (-\x, -\y, 0) -- ++(0, 0, \z) node[anchor=north east] {$(-1, -1, 0)$};
  \draw (\x, -\y, 0) -- ++(0, 0, \z);
{% endpgf %}
</div>

 It's up to the graphics card to map the NDC cube to our screen coordinates, so
 this is where our effort ends.

I've skipped over the fact that you can provide vertices in what's known as
"clip space". To enable support for applying rotations, translations and scaling
via multiplication, we have to use homogeneous coordinates[^2]. The value of
using multiplication is that we can compress all of the matrices we derive in
the next few posts into one or two instead of applying each translation
operation independently from the others. This means that we may pass in a vertex
which has a fourth $$w$$-component. As long as dividing your $$x, y, z$$
coordinates by $$w$$ produces a point within your NDC, you have a point which is
correctly mapped to clip-space. The idea here is that the graphics card will
perform clipping of triangles which are not within this space _before_ dividing
by $$w$$, as that just introduces more work for the graphics card.

I'm going to work in a right-handed coordinate system as it produces more
challenging gotchas to the proofs (or because I'm a creature of habit). I'll do
this until the point at which we have to produce the points in NDC, which has to
be left-handed, as depicted at the beginning of the post.

All of these transformations combined are usually described as the
Model-View-Projection (or MVP) matrix[^3].

* Model -- Describes the position of the model in world space (or the relative
  origin of the vertices of a given model/mesh).
* View -- Centers the camera at (0, 0, 0). Can be thought to move the whole
  world around the camera.
* Projection -- The matrix which converts what the camera sees into the
  canonical view volume (or normalized device coordinates).

I like row-major matrices (still a creature of habit), so I'll be working under
the assumption that transformations occur from right to left. In other words, to
get the final projected vertex we do $$P(V(Mv))$$.

## Model matrix

The model matrix is the simplest. Simply put, we can multiply scale ($$S$$),
rotation ($$R$$) and translation ($$T$$) matrices together (in that order) to produce
the model matrix.

$$
S = \begin{bmatrix}
Sx & 0 & 0 & 0 \\
0 & Sy & 0 & 0 \\
0 & 0 & Sz & 0 \\
0 & 0 & 0 & 1
\end{bmatrix}
$$

$$
T = \begin{bmatrix}
0 & 0 & 0 & Tx \\
0 & 0 & 0 & Ty \\
0 & 0 & 0 & Tz \\
0 & 0 & 0 & 0
\end{bmatrix}
$$

I'm skipping rotations, as I'm still debating with myself whether to use three
ordered Euler operations or finally learn and use quaternions[^4].

$$
M = T\cdot R\cdot S
$$

## View matrix

First, we need to clarify that the camera **looks down its negative** $$z$$.
Why? Because we want to work with a camera that uses right-handed coordinates,
but transforming from right-handed to left-handed (for NDC) would require all
sorts of corrections for flipping the $$x$$ and $$y$$ coordinates. So, instead,
we just move the camera in a right-handed system and then use the back as its
$$z$$-direction when actually doing the projection for our screen.

<div class="centered margin">
{% pgf camera coordinates %}
  \tikzmath{
    \x = 6;
    \y = 6;
    \z = 6;
    \b = 0.5;
    \h = 1.2;
    \v = 0.7;
    \f = 2;
  }
  %% axis lines
  \draw[black!10!red,-latex] (0, 0, 0) -- ++(\x, 0, 0) node[anchor=west] {$x$};
  \draw[black!50!green,-latex] (0, 0, 0) -- ++(0, \y, 0) node[anchor=south] {$y$};
  \draw[black!10!blue,-latex] (0, 0, 0) -- ++(0, 0, \z) node[anchor=north east] {$z$};

  %% camera
  \draw (-\b, -\b, 0) -- ++(2*\b, 0, 0) -- ++(0, 2*\b, 0) -- ++(-2*\b, 0, 0) -- cycle;

  \draw (-\b, -\b, 0) -- ++(0, 0, -\b);
  \draw (\b, -\b, 0) -- ++(0, 0, -\b);
  \draw (-\b, \b, 0) -- ++(0, 0, -\b);
  \draw (\b, \b, 0) -- ++(0, 0, -\b);
  \draw (-\b, -\b, -\b) -- ++(2*\b, 0, 0) -- ++(0, 2*\b, 0) -- ++(-2*\b, 0, 0) -- cycle;


  \draw (-\b, -\b, -\b) -- (-\h, -\v, -\f);
  \draw (\b, -\b, -\b) -- (\h, -\v, -\f);
  \draw (-\b, \b, -\b) -- (-\h, \v, -\f);
  \draw (\b, \b, -\b) -- (\h, \v, -\f);
  \draw (-\h, -\v, -\f) -- ++(2*\h, 0, 0) -- ++(0, 2*\v, 0) -- ++(-2*\h, 0, 0) -- cycle;
{% endpgf %}
</div>

So, looking at the camera itself, using negative $$z$$, we get a left-handed
coordinate system without doing any extra work! This is an important observation
for when we work on the projection matrix.

<div class="centered margin">
{% pgf camera view coordinates %}
  \tikzmath{
    \x = 6;
    \y = 6;
    \z = 6;
    \b = 0.5;
    \h = 1.2;
    \v = 0.7;
    \f = 2;
  }
  %% axis lines
  \draw[black!10!red,-latex] (0, 0, 0) -- ++(\x, 0, 0) node[anchor=west] {$x$};
  \draw[black!50!green,-latex] (0, 0, 0) -- ++(0, \y, 0) node[anchor=south] {$y$};
  \draw[black!10!blue,-latex] (0, 0, 0) -- ++(0, 0, -\z) node[anchor=south west] {$-z$};

  %% camera
  \draw (-\b, -\b, 0) -- ++(2*\b, 0, 0) -- ++(0, 2*\b, 0) -- ++(-2*\b, 0, 0) -- cycle;

  \draw (-\b, -\b, 0) -- ++(0, 0, -\b);
  \draw (\b, -\b, 0) -- ++(0, 0, -\b);
  \draw (-\b, \b, 0) -- ++(0, 0, -\b);
  \draw (\b, \b, 0) -- ++(0, 0, -\b);
  \draw (-\b, -\b, -\b) -- ++(2*\b, 0, 0) -- ++(0, 2*\b, 0) -- ++(-2*\b, 0, 0) -- cycle;


  \draw (-\b, -\b, -\b) -- (-\h, -\v, -\f);
  \draw (\b, -\b, -\b) -- (\h, -\v, -\f);
  \draw (-\b, \b, -\b) -- (-\h, \v, -\f);
  \draw (\b, \b, -\b) -- (\h, \v, -\f);
  \draw (-\h, -\v, -\f) -- ++(2*\h, 0, 0) -- ++(0, 2*\v, 0) -- ++(-2*\h, 0, 0) -- cycle;
{% endpgf %}
</div>

Now, we want to determine the view matrix, $$V$$, a matrix that centers the
camera at $$(0, 0, 0)$$. In other words, we move the world relative to the
camera. However, we can start by building the camera matrix, $$C$$, (how to
position the camera in the world), and then just invert that matrix. Simply put:

$$
V = C^{-1}
$$

The only configuration we care about for a camera is its position and rotation
(not its scale). This is similar to how we calculate the model matrix. First, we
define some 3-dimensional vectors:

$$
\begin{aligned}
\vec{e}&\ \text{(eye position)} \\
\hat{d}&\ \text{(direction)} \\
\hat{r}&\ \text{(right)} \\
\hat{u}&\ \text{(up)}
\end{aligned}
$$

The last three vectors are required to be orthogonal to each other and of unit
length for upcoming assumptions. Remembering that we are using homogeneous
coordinates, so 4x4 instead of 3x3 matrices, we can construct the translation
matrix quite simply as:

$$
T = \begin{bmatrix}
0 & 0 & 0 & e_x \\
0 & 0 & 0 & e_y \\
0 & 0 & 0 & e_z \\
0 & 0 & 0 & 1 \\
\end{bmatrix}
$$

Next we can construct the rotation matrix, $$R$$, via a change of basis[^5].
Also note that we invert the direction, as it represents the forward direction
of the camera in terms of what it can see (down the negative z-axis), but we
want to work in the right-handed coordinate system until we get to the
projection matrices.

$$
R = \begin{bmatrix}
r_x & u_x & -d_x & 0 \\
r_y & u_y & -d_y & 0 \\
r_z & u_z & -d_z & 0 \\
0 & 0 & 0 & 1 \\
\end{bmatrix}
$$

However, we need the inverses. Also note the order of transformations in the
original camera matrix below. It's rotation first, then translation (multiplying
from right to left) -- otherwise we end up rotating the camera about its offset.

$$
V = C^{-1} = (TR)^{-1} = R^{-1}T^{-1}
$$

We know, quite intuitively, that the translation matrix can just have its
components negated (you can prove this for yourself if necessary):

$$
T^{-1} = \begin{bmatrix}
1 & 0 & 0 & -e_x \\
0 & 1 & 0 & -e_y \\
0 & 0 & 1 & -e_z \\
0 & 0 & 0 & 1 \\
\end{bmatrix}
$$

Assuming the vectors for direction are normalized, we have an orthonormal
matrix[^6]. This means that the inverse can be obtained by flipping the original
matrix along its diagonal (its transpose):

$$
R^{-1} = R^T = \begin{bmatrix}
r_x & r_y & r_z & 0 \\
u_x & u_y & u_z & 0 \\
-d_x & -d_y & -d_z & 0 \\
0 & 0 & 0 & 1 \\
\end{bmatrix}
$$

Therefore we can calculate the view matrix as:

$$
\begin{aligned}
V = R^{-1}T^{-1} &= \begin{bmatrix}
r_x & r_y & r_z & 0 \\
u_x & u_y & u_z & 0 \\
-d_x & -d_y & -d_z & 0 \\
0 & 0 & 0 & 1 \\
\end{bmatrix}
\begin{bmatrix}
1 & 0 & 0 & -e_x \\
0 & 1 & 0 & -e_y \\
0 & 0 & 1 & -e_z \\
0 & 0 & 0 & 1 \\
\end{bmatrix} \\
&= \begin{bmatrix}
r_x & r_y & r_z & -e_x(r_x)-e_y(r_y)-e_z(r_z) \\
u_x & u_y & u_z & -e_x(u_x)-e_y(u_y)-e_z(u_z) \\
-d_x & -d_y & -d_z & e_x(d_x)+e_y(d_y)+e_z(d_z) \\
0 & 0 & 0 & 1 \\
\end{bmatrix}
\end{aligned}
$$

You may recognize that the entries of the last column of the matrix can be
defined by the dot product, so we can compact this quite nicely into the
following:

$$
V = \begin{bmatrix}
r_x & r_y & r_z & -\vec{e}\cdot\vec{r} \\
u_x & u_y & u_z & -\vec{e}\cdot\vec{u} \\
-d_x & -d_y & -d_z & \vec{e}\cdot\vec{d} \\
0 & 0 & 0 & 1 \\
\end{bmatrix}
$$

_Chef's kiss_.

I'll leave the definition of the projection matrix to the next two posts. I'm
going to break it up, as there are two very common projections. And, more
interestingly, the second one can be defined as a transformation applied to the
first one.

## Footnotes

[^1]: <https://www.w3.org/TR/webgpu/#coordinate-systems>
[^2]: Highly recommended post for a practical understanding of homogeneous coordinates: <https://www.tomdalling.com/blog/modern-opengl/explaining-homogenous-coordinates-and-projective-geometry/>
[^3]: A beautiful depiction of an application of the MVP: <https://jsantell.com/model-view-projection/>
[^4]: <https://eater.net/quaternions>
[^5]: <https://en.wikipedia.org/wiki/Change_of_basis>
[^6]: <https://en.wikipedia.org/wiki/Orthogonal_matrix>
