---
layout: post
title:  "3D Projection: Perspective Projection"
series: "3D projection"
date:   2023-06-28
categories: graphics
tags: [linear algebra]
---

We're finally at the last stretch for 3D projection! In this post, we want to
transform what is known as the _view frustum_[^1] into a cube. Recall from
the previous post, the following is a perspective view frustum:

<div class="centered margin">
{% pgf perspective frustum %}
  \tikzmath{
    \x = 3.5;
    \y = 2;
    \z = 4;
  }
  \begin{scope}[rotate around y=-25]
    \draw (-\x, -\y, 0) -- ++(2*\x,0,0) -- ++(0,2*\y,0) -- ++(-2*\x,0,0) -- cycle;

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

Let's first consider how to map the screen coordinates. These would be the x-
and y-coordinates. I have conveniently avoided discussing the near and far
clipping planes in previous posts, but their presence is worth discussing. In
reality, we don't have clipping planes in our view. That's why you can see Mars
with your naked eye at night, but most games seem to have some sort of fog or
terrain in the distance that can never be reached[^2]. Some of the reasons for
this limitation:

1. Depth information is stored as a floating-point value. You could increase
   this, but you could never match reality (infinite viewing distance) without
   tanking performance or running into z-fighting issues[^3].
2. The next limitation is likely your graphics card. You would not be able to
   render the number of objects that could fit in an infinitely long viewing
   frustum without running out of memory. Even if you could, it would definitely
   not be in real-time[^4].

## Derivation

Starting with the $$y$$-coordinate, let's imagine the $$x$$-axis is pointing out
of the screen from the origin (or we are looking down the $$x$$-axis).

<div class="centered margin">
{% pgf screen y coordinate %}
  \tikzmath{
    \fz = 3;
    \fy = 1.5;
    \nz = 1;
    \ny = \nz*(\fy/\fz);
    \y = 0.65;
    \z = 2;
    \ys = (\nz*\y)/\z;
    \ang = atan2(\fz,\fy);
  }
  \pgfplotsset{
    x axis line style={dashed,gray}
  }
  \begin{axis}[
    clip=false,
    axis lines=center,
    width=10cm,
    height=9cm,
    ticks=none,
    ylabel={$y$},
    xlabel={$-z$},
    xmin=0,xmax=3.5,ymin=-\fy,ymax=\fy
  ]
  \draw[-latex] (0,0) -- (-0.5, 0) node[anchor=south] {$z$};

  \draw[dashed] (0,0) -- (\nz,\ny);
  \draw[dashed] (0,0) -- (\nz,-\ny);

  \filldraw[fill=orange,fill opacity=0.2]
    (\nz,\ny) --
    (\fz,\fy) --
    (\fz,-\fy) --
    (\nz,-\ny) --
    (\nz,\ny);

  \node[anchor=north east] at (\fz,0) {$-f$};
  \node[anchor=north east] at (\nz,0) {$-n$};

  \draw[black!20!green] (0,0) -- (\z, \y) node[black,anchor=west] {$y$};
  \draw[dashed] (\z, \y) -- (\z, 0) node[anchor=north] {$z$};

  \node[circle,scale=0.5,fill=black] at (\nz,\ys) (YS) {};
  \node[anchor=north west] at (YS) {$y_s$};
  \end{axis}
{% endpgf %}
</div>

This makes it clear that the screen y-coordinate can be determined purely from
values on the y- and z-axes. Firstly, because we're using a right-handed system
but have to map to the canonical view volume, which is left-handed, we're using
the fact that the camera "looks down" its negative z-axis. So this is the
frustum after the camera has placed all objects in the world relative to its own
origin in a right-handed coordinate system. This took me a long time to digest,
so feel free to draw it out or do the maths with me to help your
understanding[^5].

If you want to, you can depart from my derivations and try and do a purely
left-handed system (from world coordinates all the way to screen projection).
You will run into fewer issues and probably tear out less hair. Since I
apparently have a penchant for pain, we'll keep moving forward with a mixed
system.

So, from the above, we can determine the value of $$y_s$$ ($$y$$ projected onto
the screen) using _similar triangles_[^6]. Noting that the coordinate of the
point (vertex) in space that we are projecting is at $$(x, y, z)$$.

$$
\begin{align}
  \frac{y_s}{-n} &= \frac{y}{z} \\
  \therefore y_s &= \frac{ny}{-z}
\end{align}
$$

The near and far clipping planes are simply specified as positive values, so
I've explicitly negated them so that their signs match the $$z$$-coordinate's
sign[^7]. Similarly, we can imagine looking down the y-axis to determine the
screen $$x$$-coordinate, $$x_s$$:

$$
\begin{align}
  \frac{x_s}{-n} &= \frac{x}{z} \\
  \therefore x_s &= \frac{nx}{-z}
\end{align}
$$

I've moved the sign next to the $$z$$-coordinate because we are going to take
advantage of homogeneous coordinates, again. We can construct the desired
transformation matrix as follows:

$$
\begin{bmatrix}
  n & 0 & 0 & 0 \\
  0 & n & 0 & 0 \\
  0 & 0 & m_1 & m_2 \\
  0 & 0 & \color{red}{-1} & 0 \\
\end{bmatrix}
\begin{bmatrix}
  x \\
  y \\
  z \\
  w \\
\end{bmatrix}
= \begin{bmatrix}
  x_s = nx \\
  y_s = ny \\
  z_s = z^2 \\
  -z \\
\end{bmatrix}
$$

The approach to determining the above is to draw an empty 4x4 transformation
matrix (a partial perspective projection). I then filled in the coordinates for
a vertex $$(x, y, z, 1)$$ and the resultant answer. I knew that I wanted to
divide the $$x$$- and $$y$$-coordinates by $$-z$$, so I reserved that in the
final row of the resultant vector through the use of the $$\color{red}{-1}$$.

Now, this forces us to divide the $$z_s$$ coordinate by $$-z$$ when going from
clip-space to NDC. We want to preserve the initial $$z$$ as-is, but remove the
negative signs to pass to the left-handed orthographic projection derived in the
[previous post]({% post_url 2023-06-27-3d-projection-orthographic-projection
%}). Therefore we must have:

$$
\begin{align}
  \frac{z_s}{-z} &= -z \\
  z_s &= z^2
\end{align}
$$

Finally, we have the third row of the transformation matrix. We can intuitively
assume that $$x$$ and $$y$$ do not contribute to remapping the $$z$$-coordinate
back to its original scale (with the sign flipped into a positive). So we assume
the last two elements, $$m_1$$ and $$m_2$$, of the row are unknown.

$$
m_1z + m_2 = z^2
$$

We know that this equation must be satisfied at the near and far clipping
planes.

$$
\begin{align*}
  -m_1f + m_2 &= f^2 \tag{1} \\
  -m_1n + m_2 &= n^2 \tag{2} \\
  m_2 &= n^2 + m_1n \tag{3}
\end{align*}
$$

Substituting (3) into (1) we have:

$$
\begin{align*}
  -m_1f + n^2 + m_1n &= f^2 \\
  m_1(n-f) + n^2 &= f^2 \\
  m_1 &= \cfrac{f^2 - n^2}{n-f} \\
      &= \cfrac{(f-n)(f+n)}{n-f} \\
      &= -\cfrac{(n-f)(f+n)}{n-f} \\
      &= -(f+n) \\
  \therefore m_1 &= -f-n \tag{4}
\end{align*}
$$

Finally, substituting (4) into (3) we have:

$$
\begin{align*}
  m_2 &= n^2 + (-f-n)n \\
      &= n^2 - fn - n^2 \\
  \therefore m_2 &= -fn
\end{align*}
$$

Substituting in, we get the perspective-to-orthographic transformation matrix $$P_O$$:

$$
\begin{align*}
  P_O = \begin{bmatrix}
    n & 0 & 0 & 0 \\
    0 & n & 0 & 0 \\
    0 & 0 & -f-n & -fn \\
    0 & 0 & -1 & 0
  \end{bmatrix}
\end{align*}
$$

Assuming the camera is centered on the z-axis, for the orthographic projection
we have $$\ni r=-l$$, $$t=-b$$. Therefore, we can infer the following:

$$
\begin{align*}
  r+l &= 0 \\
  r-l &= 2r \\
  b+t &= 0 \\
  b-t &= 2b \\
\end{align*}
$$

Now, combining the orthographic and perspective-to-orthographic matrices, we get
the perspective projection matrix, $$P$$.

$$
\begin{align*}
  P = O P_O &= 
  \begin{bmatrix}
    \frac{2}{r-l} & 0 & 0 & -\frac{r+l}{r-l} \\
    0 & \frac{2}{t-b} & 0 & -\frac{t+b}{t-b} \\
    0 & 0 & \frac{1}{f-n} & -\frac{n}{f-n} \\
    0 & 0 & 0 & 1 \\
  \end{bmatrix}
  \begin{bmatrix}
    n & 0 & 0 & 0 \\
    0 & n & 0 & 0 \\
    0 & 0 & -f-n & -fn \\
    0 & 0 & -1 & 0
  \end{bmatrix} \\
  &= \begin{bmatrix}
    \frac{n}{r} & 0 & 0 & 0 \\
    0 & -\frac{n}{b} & 0 & 0 \\
    0 & 0 & -\frac{f}{f-n} & -\frac{fn}{f-n} \\
    0 & 0 & -1 & 0 \\
  \end{bmatrix}
\end{align*}
$$

We're nearly there, however we can make some additional reductions to this
matrix. Let's consider the view frustum again with some additional annotations:

<div class="centered margin">
{% pgf annotated frustum %}
  \tikzmath{
    \fx = 3;
    \fz = 4;
    \nz = 2;
    \nx = \nz*(\fx/\fz);
  }

  \begin{axis}[
    axis lines=none,
    view={35}{50},
    width=12cm,
    height=12cm,
    ticks=none,
    xmin=-5,xmax=5,ymin=0,ymax=\fz,zmin=-5,zmax=5,
    ]
    %% Solid frustum lines
    \draw (-\nx, \nz, \nx) -- (-\fx, \fz, \fx);
    \draw (\nx, \nz, \nx) -- (\fx, \fz, \fx);
    \draw (-\nx, \nz, -\nx) -- (-\fx, \fz, -\fx);
    \draw (\nx, \nz, -\nx) -- (\fx, \fz, -\fx);

    %% Far clipping plane
    \draw (\fx, \fz, \fx) -- (-\fx, \fz, \fx);
    \draw (-\fx, \fz, \fx) -- (-\fx, \fz, -\fx);
    \draw (-\fx, \fz, -\fx) -- (\fx, \fz, -\fx);
    \draw (\fx, \fz, -\fx) -- (\fx, \fz, \fx);

    %% Near clipping plane
    \draw[black!30!green] (\nx, \nz, \nx) -- (-\nx, \nz, \nx) node[midway,anchor=south] {$w$};
    \draw[black!30!green] (\nx, \nz, -\nx) -- (\nx, \nz, \nx) node[midway,anchor=west] {$h$};
    \draw (-\nx, \nz, -\nx) -- (\nx, \nz, -\nx);
    \draw (-\nx, \nz, \nx) -- (-\nx, \nz, -\nx);

    %% Field-of-view angle theta
    \filldraw[red,fill opacity=0.2] (0, 0, 0) -- (0, \nz, \nx) node[midway,anchor=north,opacity=1] {$\theta$} -- (0, \nz, -\nx) -- (0, 0, 0);

    %% Dashed frustum lines
    \draw[dashed] (0, 0, 0) -- (-\nx, \nz, \nx);
    \draw[dashed] (0, 0, 0) -- (\nx, \nz, \nx);
    \draw[dashed] (0, 0, 0) -- (-\nx, \nz, -\nx);
    \draw[dashed] (0, 0, 0) -- (\nx, \nz, -\nx);

    \fill[orange] (\nx, \nz, -\nx) circle (2pt) node[anchor=north west] {$(r, b, n)$};
  \end{axis}
{% endpgf %}
</div>

We can specify the aspect ratio as the ratio between the screen width and screen
height $$\left(a = \frac{width}{height}\right)$$.

$$
\begin{align*}
  -b &= n\tan{\frac{\theta}{2}} \tag{b is negative} \\
  r &= an\tan{\frac{\theta}{2}}
\end{align*}
$$

Therefore, the final perspective projection matrix can be given as:

$$
\begin{align*}
  P &=
  \begin{bmatrix}
    \frac{1}{a\tan{\frac{\theta}{2}}} & 0 & 0 & 0 \\
    0 & \frac{1}{\tan{\frac{\theta}{2}}} & 0 & 0 \\
    0 & 0 & -\frac{f}{f-n} & -\frac{fn}{f-n} \\
    0 & 0 & -1 & 0
  \end{bmatrix} \\
  &= \begin{bmatrix}
    \frac{1}{a\tan{\frac{\theta}{2}}} & 0 & 0 & 0 \\
    0 & \frac{1}{\tan{\frac{\theta}{2}}} & 0 & 0 \\
    0 & 0 & \frac{f}{n-f} & \frac{fn}{n-f} \\
    0 & 0 & -1 & 0
  \end{bmatrix}
\end{align*}
$$

And that's it! With all of these combined, you can create a mapping from 3D
space to a perspective-projected space represented in normalized device
coordinates. Unfortunately, we still need to do some work in the WebGPU series
before we get to see the application, but it is very close!

## Footnotes

[^1]: Frustum is Latin for "morsel" or "piece cut off".
[^2]: Commonly referred to as a [skybox](https://en.wikipedia.org/wiki/Skybox_(video_games)).
[^3]: <https://en.wikipedia.org/wiki/Z-fighting>
[^4]: The 60+ FPS dream is dead.
[^5]: I had a sign flipped in the view matrix for the longest time when originally figuring these out for myself -- it was maddening.
[^6]: A trick from geometry that I find keeps popping up all over the place: <https://en.wikipedia.org/wiki/Similarity_(geometry)>.
[^7]: _Shakes left fist at right-handed coordinate system._
