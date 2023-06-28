---
layout: post
title:  "3D Projection: Orthographic Projection"
series: "3D projection"
date:   2023-06-27
categories: graphics
tags: [linear algebra]
---

{% include mathjax.html %}

We need to derive a projection matrix, as alluded to in the previous [post]({%
post_url 2023-06-21-3d-projection-intro-model-and-view %}). The orthographic is
the simplest to start with, but we'll move on to a perspective projection in a
subsequent post. I want to use a perspective projection for the [WebGPU game
series]({% post_url 2023-06-04-webgpu-game-1-boilerplate %}), to make the
environment a little bit more interesting.

## What is an orthographic projection?

An orthographic projection is one in which objects in the distance do not appear
smaller than objects that are nearby. This is not true to how we experience the
natural world around us[^1]. However, it is common for stylistic applications or
for computer-aided design (CAD) software. The following is a representation of
an orthographic projection compared to a perspective projection.

<div class="centered margin">
{% pgf orthographic comparison %}
  \tikzmath{
    \x = 2;
    \y = 2;
    \z = 2;
    \offset = 10;
  }
  \begin{scope}[rotate around y=-30]
  %% back
  \draw (-\x, -\y, 0) -- ++(2*\x,0,0) -- ++(0,2*\y,0) -- ++(-2*\x,0,0) -- cycle;

  %% front
  \draw[black,fill=cyan,fill opacity=0.1] (-\x, -\y, \z) -- ++(2*\x,0,0) -- ++(0,2*\y,0) node[at start,opacity=1,anchor=north,yshift=-5] {orthographic} -- ++(-2*\x,0,0) -- cycle;

  %% connections
  \draw (\x, \y, 0) -- ++(0, 0, \z);
  \draw (-\x, \y, 0) -- ++(0, 0, \z);
  \draw (-\x, -\y, 0) -- ++(0, 0, \z);
  \draw (\x, -\y, 0) -- ++(0, 0, \z);
  \end{scope}
  \begin{scope}[rotate around y=-30,shift={(\offset,1.5,0)}]
    \draw (-\x, -\y, 0) -- ++(2*\x,0,0) node[midway,opacity=1,anchor=north,yshift=-15] {perspective} -- ++(0,2*\y,0) -- ++(-2*\x,0,0) -- cycle;

    %% front
    \draw[black,fill=cyan,fill opacity=0.1] (-\x/2, -\y/2, \z) -- ++(\x,0,0) -- ++(0,\y,0) -- ++(-\x,0,0) -- cycle;

    %% connections
    \draw (\x/2, \y/2, \z) -- (\x, \y, 0);
    \draw (-\x/2, \y/2, \z) -- (-\x, \y, 0);
    \draw (-\x/2, -\y/2, \z) -- (-\x, -\y, 0);
    \draw (\x/2, -\y/2, \z) -- (\x, -\y, 0);
  \end{scope}
{% endpgf %}
</div>

In both cases, the volume is transformed into a cube volume with specific
dimensions -- the canonical view volume. As you can imagine, this doesn't really
distort the orthographic projection, but it heavily influences the perspective
projection.

## Desired outcome

We want to map the cube into the following ranges, assuming a left-handed
coordinate system.

$$
  x \in [-1, 1] \\
  y \in [-1, 1] \\
  z \in [0, 1]
$$

However, assume we have some orthographic camera that is not centered on the
axis and scaled to suit these requirements such as the following:

<div class="centered margin">
{% pgf orthographic on axis %}
  \tikzmath{
    \l = 1;
    \b = 1;
    \n = 1;
    \r = 4;
    \t = 3;
    \f = 3.5;
  }
  \begin{axis}[
    view={45}{25},
    axis lines=center,
    width=15cm,height=12cm,
    ticks=none,
    xmin=-5,xmax=5,ymin=-5,ymax=5,zmin=-3,zmax=4,
    xlabel={\textcolor{red}{$x$}},ylabel={\textcolor{blue}{$z$}},zlabel={\textcolor{black!40!green}{$y$}},
    x axis line style=red,
    y axis line style=blue,
    z axis line style=black!40!green,
  ]
  %% front
  \draw[black,fill=cyan,fill opacity=0.1] (\l,\n,\b) -- (\r,\n,\b) -- (\r,\n,\t) -- (\l,\n,\t) -- cycle;
  %% back
  \draw (\l,\f,\b) -- (\r,\f,\b) -- (\r,\f,\t) -- (\l,\f,\t) -- cycle;
  %% connections
  \draw (\l,\n,\b) -- (\l,\f,\b);
  \draw (\r,\n,\b) -- (\r,\f,\b);
  \draw (\l,\n,\t) -- (\l,\f,\t);
  \draw (\r,\n,\t) -- (\r,\f,\t);
  \node[circle,fill=orange,scale=0.5] at (\l,\n,\b) (lbn) {};
  \node[anchor=north west,color=orange,rotate=-20] at (lbn) {(left, bottom, near)};
  \node[circle,fill=orange,scale=0.5] at (\r,\f,\t) (rtf) {};
  \node[anchor=south east,color=orange,rotate=-20] at (rtf) {(right, top, far)};
  \end{axis}
{% endpgf %}
</div>

## Derivation

We want to shift the cube to the center and scale it to fit within the ranges
specified above.

### Steps

We want to perform the following steps (in order):

1. Translate the center, $$c$$, of the near plane to the origin: \\
   $$
   c = \left(\frac{r+l}{2},\frac{t+b}{2},n\right)
   $$

2. Scale the volume to the size of the canonical view volume, $$s_C$$: \\
   $$
   s_C = (2,2,1)
   $$

Therefore, we can calculate the orthographic projection matrix, $$O$$, as:

$$
\begin{aligned}
O = ST &=
\begin{bmatrix}
  \frac{2}{s_x} & 0 & 0 & 0 \\
  0 & \frac{2}{s_y} & 0 & 0 \\
  0 & 0 & \frac{1}{s_z} & 0 \\
  0 & 0 & 0 & 1
\end{bmatrix}
\begin{bmatrix}
  1 & 0 & 0 & -\frac{r+l}{2} \\
  0 & 1 & 0 & -\frac{t+b}{2} \\
  0 & 0 & 1 & -n \\
  0 & 0 & 0 & 1
\end{bmatrix} \\
&= \begin{bmatrix}
  \frac{2}{r-l} & 0 & 0 & 0 \\
  0 & \frac{2}{t-b} & 0 & 0 \\
  0 & 0 & \frac{1}{f-n} & 0 \\
  0 & 0 & 0 & 1
\end{bmatrix}
\begin{bmatrix}
  1 & 0 & 0 & -\frac{r+l}{2} \\
  0 & 1 & 0 & -\frac{t+b}{2} \\
  0 & 0 & 1 & -n \\
  0 & 0 & 0 & 1
\end{bmatrix} \\
\therefore O &= \begin{bmatrix}
  \frac{2}{r-l} & 0 & 0 & -\frac{r+l}{r-l} \\
  0 & \frac{2}{t-b} & 0 & -\frac{t+b}{t-b} \\
  0 & 0 & \frac{1}{f-n} & -\frac{n}{f-n} \\
  0 & 0 & 0 & 1
\end{bmatrix}
\end{aligned}
$$

There are some additional reductions that can be made, but that's essentially
the orthographic projection matrix. For example, if using this as your
projection matrix, you may simply want to store the near, far, screen width and
screen height values. Then, you simply create this matrix from the specified
values when doing the full MVP transformation.

## Footnotes

[^1]: Otherwise cosmic background radiation would have been really obvious (given we could also perceive microwave radiation).

