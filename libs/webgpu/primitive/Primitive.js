export const PrimitiveAttribute = {
  POSITION: 'postion',
  NORMAL: 'normal',
  UV: 'uv'
};

export class Primitive {
  static createPlane(width, height, segmentsW, segmentsH, attributeSet = [[PrimitiveAttribute.POSITION]]) {
    const attributeLayout = Primitive.parseAttributeSet(attributeSet);

    const positionList = [];
    const normalList = [];
    const uvList = [];
    const indexList = [];

    const halfWidth = width / 2.0;
    const halfHeight = height / 2.0;
    const segmentWidth = width / segmentsW;
    const segmentHeight = height / segmentsH;
    const wVertices = segmentsW + 1;
    const hVertices = segmentsH + 1;

    for (let j = 0; j < hVertices; j++) {
      const posY = segmentHeight * j - halfHeight;
      const v = 1.0 - (j / segmentsH);

      for (let i = 0; i < wVertices; i++) {
        positionList.push(segmentWidth * i - halfWidth, -posY, 0.0);
        normalList.push(0.0, 0.0, 1.0);
        uvList.push(i / segmentsW, v);
      }
    }

    for (let j = 0; j < segmentsH; j++) {
      const j0 = wVertices * j;
      const j1 = wVertices * (j + 1);

      for (let i = 0; i < segmentsW; i++) {
        const i0 = i + j0;
        const i1 = i + j1;
        const i2 = i + 1 + j1;
        const i3 = i + 1 + j0;
        indexList.push(i0, i1, i3);
        indexList.push(i1, i2, i3);
      }
    }

    const numVertices = positionList.length / 3;
    const attributeBufferDataList = Primitive.packBufferData(numVertices, attributeLayout, positionList, normalList, uvList);

    return {
      attributeBufferDataList,
      indexList
    }
  }

  static createSphere(radius, segmentsW, segmentsH, attributeSet = [[PrimitiveAttribute.POSITION]]) {
    const attributeLayout = Primitive.parseAttributeSet(attributeSet);

    const positionList = [];
    const normalList = [];
    const uvList = [];
    const indexList = [];

    const vec = vec3.create();
    const grid = [];
    let idx = 0;

    const PI_2 = Math.PI * 2.0;
    for (let j = 0; j <= segmentsH; j++) {
      const verticesRow = [];
      const v = j / segmentsH;
      const theta = v * Math.PI;
      const rSinT = radius * Math.sin(theta);
      const rCosT = radius * Math.cos(theta);

      for (let i = 0; i <= segmentsW; i++) {
        const u = i / segmentsW;
        const phi = u * PI_2;
        vec[0] = -Math.cos(phi) * rSinT;
        vec[1] = rCosT;
        vec[2] = Math.sin(phi) * rSinT;
        positionList.push(vec[0], vec[1], vec[2]);
        vec3.normalize(vec, vec);
        normalList.push(vec[0], vec[1], vec[2]);
        uvList.push(u, 1 - v);
        verticesRow.push(idx);
        idx += 1;
      }
      grid.push(verticesRow);
    }

    for (let j = 0; j < segmentsH; j++) {
      const gridJ0 = grid[j];
      const gridJ1 = grid[j + 1];
      for (let i = 0; i < segmentsW; i++) {
        const i0 = gridJ0[i + 1];
        const i1 = gridJ0[i];
        const i2 = gridJ1[i];
        const i3 = gridJ1[i + 1];

        if (j !== 0) {
          indexList.push(i0, i1, i3);
        }
        if (j !== segmentsH - 1) {
          indexList.push(i1, i2, i3);
        }
      }
    }

    const numVertices = positionList.length / 3;
    const attributeBufferDataList = Primitive.packBufferData(numVertices, attributeLayout, positionList, normalList, uvList);

    return {
      attributeBufferDataList,
      indexList
    }
  }

  static createTorus(radius, tube, segmentsR, segmentsT, attributeSet = [[PrimitiveAttribute.POSITION]]) {
    const attributeLayout = Primitive.parseAttributeSet(attributeSet);

    const positionList = [];
    const normalList = [];
    const uvList = [];
    const indexList = [];

    const vec = vec3.create();

    const PI_2 = Math.PI * 2.0;
    for (let j = 0; j <= segmentsR; j++) {
      const vUnit = j / segmentsR;
      const v = vUnit * PI_2;
      const cosV = Math.cos(v);
      const posZ = tube * Math.sin(v);

      for (let i = 0; i <= segmentsT; i++) {
        const uUnit = i / segmentsT;
        const u = uUnit * PI_2;
        const cosU = Math.cos(u);
        const sinU = Math.sin(u);
        const rr = radius + tube * cosV;

        vec[0] = rr * cosU;
        vec[1] = rr * sinU;
        vec[2] = posZ;
        positionList.push(vec[0], vec[1], vec[2]);

        vec[0] -= radius * cosU;
        vec[1] -= radius * sinU;
        vec3.normalize(vec, vec);
        normalList.push(vec[0], vec[1], vec[2]);

        uvList.push(uUnit, vUnit);
      }
    }

    for (let j = 1; j <= segmentsR; j++) {
      for (let i = 1; i <= segmentsT; i++) {
        const seg = segmentsT + 1;
        const i0 = seg * j + i - 1;
        const i1 = seg * (j - 1) + i - 1;
        const i2 = seg * (j - 1) + i;
        const i3 = seg * j + i;
        indexList.push(i0, i1, i3);
        indexList.push(i1, i2, i3);
      }
    }

    const numVertices = positionList.length / 3;
    const attributeBufferDataList = Primitive.packBufferData(numVertices, attributeLayout, positionList, normalList, uvList);

    return {
      attributeBufferDataList,
      indexList
    }
  }

  static parseAttributeSet(attributeSet) {
    if (!Array.isArray(attributeSet)) {
      throw new Error('attributeSet should be an Array.')
    }
    const attributeBufferElementsList = [];
    let usePosition = false;
    let useNormal = false;
    let useUV = false;
    let positionBufferIndex = -1;
    let normalBufferIndex = -1;
    let uvBufferIndex = -1;
    let positionBufferOffset = -1;
    let normalBufferOffset = -1;
    let uvBufferOffset = -1;
    const bufferNum = attributeSet.length;
    for (let i = 0; i < bufferNum; i++) {
      const attributeBuffer = attributeSet[i];
      if (!Array.isArray(attributeBuffer)) {
        throw new Error('Second hierarchy of attributeSet should be an Array.')
      }
      let offset = 0;
      const attributeNum = attributeBuffer.length;
      for (let j = 0; j < attributeNum; j++) {
        const attribute = attributeBuffer[j];
        if (attribute === PrimitiveAttribute.POSITION) {
          if (usePosition) {
            throw new Error('POSITION attribute has already defined.')
          } else {
            usePosition = true;
            positionBufferIndex = i;
            positionBufferOffset = offset;
            offset += 3;
          }
        } else if (attribute === PrimitiveAttribute.NORMAL) {
          if (useNormal) {
            throw new Error('NORMAL attribute has already defined.')
          } else {
            useNormal = true;
            normalBufferIndex = i;
            normalBufferOffset = offset;
            offset += 3;
          }
        } else if (attribute === PrimitiveAttribute.UV) {
          if (useUV) {
            throw new Error('UV attribute has already defined.')
          } else {
            useUV = true;
            uvBufferIndex = i;
            uvBufferOffset = offset;
            offset += 2;
          }
        } else {
          const num = Math.floor(attribute);
          if (num > 0) {
            offset += num;
          } else {
            throw new Error('attribute elements specification should be greater than 1.');
          }
        }
      }
      attributeBufferElementsList[i] = offset;
    }
    if (!usePosition) {
      throw new Error('POSITION attribute should be defined.')
    }

    return {
      attributeBufferElementsList: attributeBufferElementsList,
      positionBufferIndex,
      normalBufferIndex,
      uvBufferIndex,
      positionBufferOffset,
      normalBufferOffset,
      uvBufferOffset
    };
  }

  static packBufferData(numVertices, attributeLayout, positionList, normalList, uvList) {
    const attributeBufferDataList = [];
    const bufferNum = attributeLayout.attributeBufferElementsList.length;
    for (let i = 0; i < bufferNum; i++) {
      const numElements = attributeLayout.attributeBufferElementsList[i];
      const bufferData = new Float32Array(numVertices * numElements);
      for (let j = 0; j < numVertices; j++) {
        const offset = j * numElements;
        if (attributeLayout.positionBufferIndex === i) {
          const positionBufferOffset = offset + attributeLayout.positionBufferOffset;
          const positionListOffset = j * 3;
          bufferData[positionBufferOffset] = positionList[positionListOffset];
          bufferData[positionBufferOffset + 1] = positionList[positionListOffset + 1];
          bufferData[positionBufferOffset + 2] = positionList[positionListOffset + 2];
        }
        if (attributeLayout.normalBufferIndex === i) {
          const normalBufferOffset = offset + attributeLayout.normalBufferOffset;
          const normalListOffset = j * 3;
          bufferData[normalBufferOffset] = normalList[normalListOffset];
          bufferData[normalBufferOffset + 1] = normalList[normalListOffset + 1];
          bufferData[normalBufferOffset + 2] = normalList[normalListOffset + 2];
        }
        if (attributeLayout.uvBufferIndex === i) {
          const uvBufferOffset = offset + attributeLayout.uvBufferOffset;
          const uvListOffset = j * 2;
          bufferData[uvBufferOffset] = uvList[uvListOffset];
          bufferData[uvBufferOffset + 1] = uvList[uvListOffset + 1];
        }
      }
      attributeBufferDataList[i] = bufferData;
    }
    return attributeBufferDataList;
  }

  static createWireframeIndices(triangleIndexList) {
    let imin;
    let imax;
    let key;

    const hash = {};
    const lineIndexList = [];
    const length = triangleIndexList.length / 3;
    for (let i = 0; i < length; i++) {
      const i0 = triangleIndexList[i * 3];
      const i1 = triangleIndexList[i * 3 + 1];
      const i2 = triangleIndexList[i * 3 + 2];

      // i0:i1
      imin = i0 > i1 ? i1 : i0;
      imax = i0 > i1 ? i0 : i1;
      key = imin + ":" + imax;
      if (!hash[key]) {
        hash[key] = true;
        lineIndexList.push(imin, imax);
      }

      // i1:i2
      imin = i1 > i2 ? i2 : i1;
      imax = i1 > i2 ? i1 : i2;
      key = imin + ":" + imax;
      if (!hash[key]) {
        hash[key] = true;
        lineIndexList.push(imin, imax);
      }

      // i2:i0
      imin = i2 > i0 ? i0 : i2;
      imax = i2 > i0 ? i2 : i0;
      key = imin + ":" + imax;
      if (!hash[key]) {
        hash[key] = true;
        lineIndexList.push(imin, imax);
      }
    }

    return lineIndexList;
  }
}
