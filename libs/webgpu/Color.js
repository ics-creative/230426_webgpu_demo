export class Color {
  static createRGBFromHSV(h, s, v, a = 1.0) {
    if (s > 1.0) {
      s = 1.0;
    }

    if (v > 1.0) {
      v = 1.0;
    }

    let th = (h + 360) % 360;
    let i = Math.floor(th / 60);
    let f = th / 60 - i;
    let m = v * (1 - s);
    let n = v * (1 - s * f);
    let k = v * (1 - s * (1 - f));

    let color;
    if (s === 0) {
      color = [v, v, v];
    } else {
      switch (i) {
        case 0: {
          color = [v, k, m];
          break;
        }
        case 1: {
          color = [n, v, m];
          break;
        }
        case 2: {
          color = [m, v, k];
          break;
        }
        case 3: {
          color = [m, n, v];
          break;
        }
        case 4: {
          color = [k, m, v];
          break;
        }
        case 5: {
          color = [v, m, n];
          break;
        }
      }
    }
    return vec4.fromValues(color[0], color[1], color[2], a);
  }
}
