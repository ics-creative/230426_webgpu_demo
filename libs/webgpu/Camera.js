export class Camera {
  constructor(fov, aspect, zNear, zFar, useNdcZ0to1 = false, flipNdcY = false) {
    this._fov = fov;
    this._aspect = aspect;
    this._zNear = zNear;
    this._zFar = zFar;
    this._useNdcZ0to1 = useNdcZ0to1;
    this._flipNdcY = flipNdcY;

    this._cameraUP = vec3.fromValues(0.0, 1.0, 0.0);
    //
    this._cameraPos = vec3.fromValues(0.0, 0.0, 0.0);
    this._projectionMtx = mat4.identity(mat4.create());
    this._cameraMtx = mat4.identity(mat4.create());
    this._lookMtx = mat4.identity(mat4.create());
    //
    this.x = this._cameraPos[0];
    this.y = this._cameraPos[1];
    this.z = this._cameraPos[2];

    this._resetProjectionMatrix();
  }

  _perspectiveNdcZ0to1(out, fovy, aspect, near, far) {
    let f = 1.0 / Math.tan(fovy / 2), nf;
    out[0] = f / aspect;
    out[1] = 0;
    out[2] = 0;
    out[3] = 0;
    out[4] = 0;
    out[5] = f;
    out[6] = 0;
    out[7] = 0;
    out[8] = 0;
    out[9] = 0;
    out[11] = -1;
    out[12] = 0;
    out[13] = 0;
    out[15] = 0;
    nf = 1 / (near - far);
    out[10] = far * nf;
    out[14] = (far * near) * nf;
    return out;
  }

  getCameraMtx() {
    return this._cameraMtx;
  }

  getProjectionMtx() {
    return this._projectionMtx;
  }

  lookAt(point) {
    vec3.set(this._cameraPos, this.x, this.y, this.z);
    mat4.lookAt(this._lookMtx, this._cameraPos, point, this._cameraUP);
    mat4.multiply(this._cameraMtx, this._projectionMtx, this._lookMtx);
  }

  set aspect($aspect) {
    this._aspect = $aspect;
    this._resetProjectionMatrix();
  }

  _resetProjectionMatrix() {
    if (this._useNdcZ0to1) {
      this._perspectiveNdcZ0to1(this._projectionMtx, this._fov, this._aspect, this._zNear, this._zFar);
    } else {
      mat4.perspective(this._projectionMtx, this._fov, this._aspect, this._zNear, this._zFar);
    }

    if (this._flipNdcY) {
      this._projectionMtx[5] *= -1;
    }
  }
}