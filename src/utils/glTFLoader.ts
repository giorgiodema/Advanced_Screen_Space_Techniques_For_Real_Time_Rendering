import * as Matrix from './math';
import * as GlTFTypes from "../types/gltf-types"
import { loadImage, mipLevelCount,generateMipmaps } from './textureUtils';
import { DirectionalLight, PointLight, SpotLight } from '../passes/PointLights';
import { normalizeVector } from './vectors';

const MAX_FLOAT32 = 3.40282347e+38;

  export const GLTFComponentType = {
    BYTE: 5120,
    UNSIGNED_BYTE: 5121,
    SHORT: 5122,
    UNSIGNED_SHORT: 5123,
    INT: 5124,
    UNSIGNED_INT: 5125,
    FLOAT: 5126,
    DOUBLE: 5130,
  };

  export interface GPUMaterial{
    baseColorFactor:Float32Array,
    baseColorTextureId:number,
    metallicFactor:number,
    roughnessFactor:number,
    metallicRoughnessTextureId:number,
    // KHR_materials_transmission
    transmissionFactor?:number,
    transmissionTextureId?:number,
    // KHR_materials_volume
    attenuationDistance?:number,
    attenuationColor?:Float32Array,
    buffer:GPUBuffer,
  }

  export class GPUMaterialBase implements GPUMaterial{
    /*
    * Maps to pbrMetallicRoughness model in glTF, the textureId
    * fields refer to the textures that are loaded in the glTF
    * scene. When the object is instantiated it creates a buffer
    * that is ready to be bound to the Material struct in the 
    * WGSL. The WGSL Material assumes that the correct textures
    * are already binded, so the textureIds are used to retrieve
    * the right testures in the GPUScene textures array. If the 
    * texture is not used the id is -1.
    */
    public baseColorFactor:Float32Array;
    public baseColorTextureId:number;
    public metallicFactor:number;
    public roughnessFactor:number;
    public metallicRoughnessTextureId:number;
    public buffer:GPUBuffer;

    constructor(  baseColorFactor:Float32Array,
                  baseColorTextureId:number, 
                  metallicFactor:number, 
                  roughnessFactor:number, 
                  metallicRoughnessTextureId:number,
                  device:GPUDevice){
      this.baseColorFactor = baseColorFactor;
      this.baseColorTextureId = baseColorTextureId;
      this.metallicFactor = metallicFactor;
      this.roughnessFactor = roughnessFactor;
      this.metallicRoughnessTextureId = metallicRoughnessTextureId;
      // create the GPUBuffer, that will be bound to the
      // shader Material Struct
      let array = new ArrayBuffer(
        16 + //  baseColorFactor
        4  + //  baseColorTextureId (-1 if no texture is used)
        4  + //  metallicFactor
        4  + //  roughnessFactor
        4    //  metallicRoughenssTextureId
      );
      let baseColorFactorArray = new Float32Array(array,0,4);
      let baseColorTextureIdArray = new Int32Array(array,16,1);
      let metallicRoughnessFactorsArray = new Float32Array(array,20,2);
      let metallicRoughenssTextureIdArray = new Int32Array(array,28,1);
      baseColorFactorArray.set(baseColorFactor);
      baseColorTextureIdArray.set([baseColorTextureId]);
      metallicRoughnessFactorsArray.set([this.metallicFactor,this.roughnessFactor]);
      metallicRoughenssTextureIdArray.set([this.metallicRoughnessTextureId]);

      this.buffer = device.createBuffer(
        {
          label:"GPU Material Buffer",
          size: 32, // (remember that a uniform buffer should be at least 32 bytes)
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          mappedAtCreation:true
        }
      );
      let dst = new Uint8Array(this.buffer.getMappedRange());
      dst.set(new Uint8Array(array));
      this.buffer.unmap();
    }
  };

  export class GPUMaterialTransmission implements GPUMaterial{
    /*
    * Maps to pbrMetallicRoughness model in glTF, the textureId
    * fields refer to the textures that are loaded in the glTF
    * scene. When the object is instantiated it creates a buffer
    * that is ready to be bound to the Material struct in the 
    * WGSL. The WGSL Material assumes that the correct textures
    * are already binded, so the textureIds are used to retrieve
    * the right testures in the GPUScene textures array. If the 
    * texture is not used the id is -1.
    */
    public baseColorFactor:Float32Array;
    public baseColorTextureId:number;
    public metallicFactor:number;
    public roughnessFactor:number;
    public metallicRoughnessTextureId:number;
    public transmissionFactor:number;
    public transmissionTextureId: number;
    public buffer:GPUBuffer;

    constructor(  baseColorFactor:Float32Array,
                  baseColorTextureId:number, 
                  metallicFactor:number, 
                  roughnessFactor:number, 
                  metallicRoughnessTextureId:number,
                  transmissionFactor:number,
                  transmissionTextureId:number,
                  device:GPUDevice){
      this.baseColorFactor = baseColorFactor;
      this.baseColorTextureId = baseColorTextureId;
      this.metallicFactor = metallicFactor;
      this.roughnessFactor = roughnessFactor;
      this.metallicRoughnessTextureId = metallicRoughnessTextureId;
      this.transmissionFactor = transmissionFactor;
      this.transmissionTextureId = transmissionTextureId;
      // create the GPUBuffer, that will be bound to the
      // shader Material Struct
      let array = new ArrayBuffer(
        16 + //  baseColorFactor
        4  + //  baseColorTextureId (-1 if no texture is used)
        4  + //  metallicFactor
        4  + //  roughnessFactor
        4  + //  metallicRoughenssTextureId
        4  + //  transmissionFactor
        4  + //  transmissionTextureId
        8    // padding
      );
      let baseColorFactorArray = new Float32Array(array,0,4);
      let baseColorTextureIdArray = new Int32Array(array,16,1);
      let metallicRoughnessFactorsArray = new Float32Array(array,20,2);
      let metallicRoughenssTextureIdArray = new Int32Array(array,28,1);
      let transmissionFactorArray = new Float32Array(array,32,1);
      let transmissionTextureIdArray = new Int32Array(array,36,1);
      baseColorFactorArray.set(baseColorFactor);
      baseColorTextureIdArray.set([baseColorTextureId]);
      metallicRoughnessFactorsArray.set([this.metallicFactor,this.roughnessFactor]);
      metallicRoughenssTextureIdArray.set([this.metallicRoughnessTextureId]);
      transmissionFactorArray.set([this.transmissionFactor]);
      transmissionTextureIdArray.set([this.transmissionTextureId]);

      this.buffer = device.createBuffer(
        {
          label:"GPU Material Buffer",
          size: 48, // (remember that a uniform buffer should be at least 32 bytes and multiple of 16 bytes)
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          mappedAtCreation:true
        }
      );
      let dst = new Uint8Array(this.buffer.getMappedRange());
      dst.set(new Uint8Array(array));
      this.buffer.unmap();
    }
  };

  export class GPUMaterialVolume implements GPUMaterial{
    /*
    * Maps to pbrMetallicRoughness model in glTF, the textureId
    * fields refer to the textures that are loaded in the glTF
    * scene. When the object is instantiated it creates a buffer
    * that is ready to be bound to the Material struct in the 
    * WGSL. The WGSL Material assumes that the correct textures
    * are already binded, so the textureIds are used to retrieve
    * the right testures in the GPUScene textures array. If the 
    * texture is not used the id is -1.
    */
    public baseColorFactor:Float32Array;
    public baseColorTextureId:number;
    public metallicFactor:number;
    public roughnessFactor:number;
    public metallicRoughnessTextureId:number;
    public transmissionFactor:number;
    public transmissionTextureId: number;
    public attenuationDistance: number;
    public attenuationColor: Float32Array;
    public buffer:GPUBuffer;

    constructor(  baseColorFactor:Float32Array,
                  baseColorTextureId:number, 
                  metallicFactor:number, 
                  roughnessFactor:number, 
                  metallicRoughnessTextureId:number,
                  transmissionFactor:number,
                  transmissionTextureId:number,
                  attenuationDistance:number,
                  attenuationColor:Float32Array,
                  device:GPUDevice){
      this.baseColorFactor = baseColorFactor;
      this.baseColorTextureId = baseColorTextureId;
      this.metallicFactor = metallicFactor;
      this.roughnessFactor = roughnessFactor;
      this.metallicRoughnessTextureId = metallicRoughnessTextureId;
      this.transmissionFactor = transmissionFactor;
      this.transmissionTextureId = transmissionTextureId;
      this.attenuationDistance = attenuationDistance;
      this.attenuationColor = attenuationColor;
      // create the GPUBuffer, that will be bound to the
      // shader Material Struct
      let array = new ArrayBuffer(
        16 + //  baseColorFactor
        4  + //  baseColorTextureId (-1 if no texture is used)
        4  + //  metallicFactor
        4  + //  roughnessFactor
        4  + //  metallicRoughenssTextureId
        16 + //  attenuationColor
        4  + //  attenuationDistance
        4  + //  transmissionFactor
        4  + //  transmissionTextureId
        4    // padding
      );
      let baseColorFactorArray = new Float32Array(array,0,4);
      let baseColorTextureIdArray = new Int32Array(array,16,1);
      let metallicRoughnessFactorsArray = new Float32Array(array,20,2);
      let metallicRoughenssTextureIdArray = new Int32Array(array,28,1);
      let attenuationColorArray = new Float32Array(array,32,4);
      let attenuationDistanceArray = new Float32Array(array,48,1);
      let transmissionFactorArray = new Float32Array(array,52,1);
      let transmissionTextureIdArray = new Int32Array(array,56,1);
      baseColorFactorArray.set(baseColorFactor);
      baseColorTextureIdArray.set([baseColorTextureId]);
      metallicRoughnessFactorsArray.set([this.metallicFactor,this.roughnessFactor]);
      metallicRoughenssTextureIdArray.set([this.metallicRoughnessTextureId]);
      attenuationColorArray.set(attenuationColor);
      attenuationDistanceArray.set([attenuationDistance]);
      transmissionFactorArray.set([this.transmissionFactor]);
      transmissionTextureIdArray.set([this.transmissionTextureId]);

      this.buffer = device.createBuffer(
        {
          label:"GPU Material Buffer",
          size: 64, // (remember that a uniform buffer should be at least 32 bytes and multiple of 16 bytes)
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          mappedAtCreation:true
        }
      );
      let dst = new Uint8Array(this.buffer.getMappedRange());
      dst.set(new Uint8Array(array));
      this.buffer.unmap();
    }
  };

  export class GPUMesh{
    // store on the 
    // device position buffer, normal buffer
    public vertexCount:number;
    public positions: GPUBuffer;
    public normals:GPUBuffer;
    public modelMatrix:GPUBuffer;
    public normalMatrix:GPUBuffer;
    public uvs:GPUBuffer;
    public material:GPUMaterial;

    constructor(  vertexCount:number,
                  positions:GPUBuffer, 
                  normals:GPUBuffer, 
                  modelMatrix:GPUBuffer, 
                  normalMatrix:GPUBuffer,
                  uvs:GPUBuffer, 
                  material:GPUMaterialBase){
      this.vertexCount = vertexCount;
      this.positions = positions;
      this.normals = normals;
      this.uvs = uvs;
      this.material = material;
      this.modelMatrix = modelMatrix;
      this.normalMatrix = normalMatrix;
    }
  }

  export class GPUIndexedMesh extends GPUMesh{
    public indexCount:number;
    public indexFormat:GPUIndexFormat;
    public indices:   GPUBuffer;

    constructor(  vertexCount:number,
                  positions:GPUBuffer,
                  normals:GPUBuffer,
                  modelMatrix:GPUBuffer, 
                  normalMatrix:GPUBuffer,
                  uvs:GPUBuffer, 
                  material:GPUMaterialBase, 
                  indexCount:number, 
                  indexFormat:GPUIndexFormat, 
                  indices:GPUBuffer){
      super(vertexCount,positions,normals,modelMatrix,normalMatrix,uvs,material);
      this.indexCount = indexCount;
      this.indexFormat = indexFormat;
      this.indices = indices;
    }
  }

  export class GPUScene{
    // true if the model is fully loaded
    // else false
    public loaded:boolean = false;
    
    // GPUDevice is needed to allocate
    // buffers directly on GPU
    public device:GPUDevice;

    public opaqueMeshes:GPUMesh[] = [];
    public transmissionMeshes:GPUMesh[] = [];
    public volumeMeshes:GPUMesh[] = [];
    public textures:GPUTexture[] = [];

    public pointLights:PointLight[] = [];
    public directionalLights:DirectionalLight[] = [];
    public spotLights:SpotLight[] = [];
    
    private root:string;
    private glTFPath:string;
  
    constructor(root:string,glTFPath:string,device:GPUDevice){
      this.root = root;
      this.glTFPath = glTFPath;
      this.device = device;
    }
  
    private async initialize(){
      //fetch the glTF json
     const response = await fetch(this.root +"/"+ this.glTFPath);
      if (!response.ok) {
        throw new Error(`Failed to fetch glTF, status: ${response.status}`);
      }
      let glTF:GlTFTypes.GlTF = await response.json();
      if(!glTF.scenes)throw Error("glTF Format Error: scenes attribute not found");
      if(!glTF.nodes)throw Error("glTF Format Error: nodes attribute not found");
      if(!glTF.meshes)throw Error("glTF Format Error: meshes attribute not found");
      if(!glTF.accessors)throw Error("glTF Format Error: accessors attribute not found");
      if(!glTF.buffers)throw Error("glTF Format Error: buffers attribute not found");
      if(!glTF.bufferViews)throw Error("glTF Format Error: scenes attribute not found");
      if(!glTF.materials)throw Error("glTF Format Error: empty materials");

      // fetch the textures
      if(glTF.textures){
        for(const glTFTexture of glTF.textures){
          let url = glTF.images![glTFTexture.source!].uri!;
          let image = await loadImage(this.root +"/"+url);
          let miplevels = mipLevelCount(image.width,image.height);
          let texture = this.device.createTexture(
            {
              size:{width:image.width,height:image.height},
              format:"rgba8unorm",
              usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
              mipLevelCount:miplevels
            });
            const mipmaps: ImageData[] = generateMipmaps(image, image.width, image.height);
          for (let level = 0; level < mipmaps.length; level++) {
              const mipmap = mipmaps[level];
              this.device.queue.writeTexture(
                  { texture: texture, origin: { x: 0, y: 0}, mipLevel: level },
                  mipmap.data,
                  { bytesPerRow: mipmap.width * 4, rowsPerImage: mipmap.height },
                  { width: mipmap.width, height: mipmap.height, depthOrArrayLayers: 1 }
              );
          };
          this.textures.push(texture);
        }
      }

  
      // fetch the buffers
      let buffers: ArrayBuffer[] = [];
      for(const glTFBuffer of glTF.buffers){
        const response = await fetch(this.root + "/" + glTFBuffer.uri);
        if (!response.ok) {
          throw new Error(`Failed to fetch buffer, status: ${response.status}`);
        }
        const buffer:ArrayBuffer = await response.arrayBuffer();
        buffers.push(buffer);
      }
  
      // create bufferviews from buffers
      let bufferViews: ArrayBuffer[] = [];
      for (const glTFBufferView of glTF.bufferViews){
        let byteOffset = glTFBufferView.byteOffset ? glTFBufferView.byteOffset : 0;
        bufferViews.push(
          buffers[glTFBufferView.buffer].slice(byteOffset,byteOffset + glTFBufferView.byteLength)
        );
      }

      // load the default scene
      let scene:GlTFTypes.GlTFScene = glTF.scene ? glTF.scenes[glTF.scene] : glTF.scenes[0];
      // compute the base transform for each
      // node, the ith index in the transforms
      // is the modelMatrix for the ith node
      let transforms = GPUScene.computeTransforms(glTF.nodes);
      // compute the transformation of the parents
      // traversing the scene graph (post-order)
      for(const nodeId of scene.nodes){
        GPUScene.traverse(glTF.nodes[nodeId],glTF.nodes,transforms,nodeId,nodeId);
      }


      // traverse nodes and create buffers
      for (let i = 0; i < glTF.nodes.length; i++){
        let node = glTF.nodes[i];

        if(node.extensions?.KHR_lights_punctual !== undefined){
          let transform = transforms.get(i)!;
          let light = glTF.extensions!.KHR_lights_punctual!.lights[node.extensions?.KHR_lights_punctual.light];
          switch(light.type){
            case 'directional':{
              let intensity = light.intensity!==undefined ? light.intensity : 1;
              let color = light.color ? new Float32Array(light.color) : new Float32Array([1.0,1.0,1.0]);
              let direction = new Float32Array([0.0,0.0,-1.0,0.0]);
              direction = Matrix.multiplyMatrixVector(transform,direction);
              direction = new Float32Array([direction[0],direction[1],direction[2]]);
              direction = normalizeVector(direction);

              this.directionalLights.push(new DirectionalLight(
                intensity,
                color,
                direction,
                false
              ));

              break;
            }
            case 'point':{
              let intensity = light.intensity!==undefined ? light.intensity : 1;
              let color = light.color ? new Float32Array(light.color) : new Float32Array([1.0,1.0,1.0]);
              let position = new Float32Array([0.0,0.0,0.0,1.0]);

              position = Matrix.multiplyMatrixVector(transform,position);
              position = new Float32Array([position[0],position[1],position[2]]);

              this.pointLights.push(new PointLight(
                intensity,
                color,
                position,
                false
              ));              
              break;
            }
            case 'spot':{
              let intensity = light.intensity!==undefined ? light.intensity : 1;
              let color = light.color ? new Float32Array(light.color) : new Float32Array([1.0,1.0,1.0]);
              let innerConeAngle = light.spot?.innerConeAngle!==undefined ? light.spot.innerConeAngle : 0.0;
              let outerConeAngle = light.spot?.outerConeAngle!==undefined ? light.spot.outerConeAngle : Math.PI / 4.0;
              let position = new Float32Array([0.0,0.0,0.0,1.0]);

              position = Matrix.multiplyMatrixVector(transform,position);
              position = new Float32Array([position[0],position[1],position[2]]);

              let direction = new Float32Array([0.0,0.0,-1.0,0.0]);
              direction = Matrix.multiplyMatrixVector(transform,direction);
              direction = new Float32Array([direction[0],direction[1],direction[2]]);
              direction = normalizeVector(direction);

              this.spotLights.push(new SpotLight(
                intensity,
                color,
                position,
                direction,
                innerConeAngle,
                outerConeAngle,
                false
              ));     
            }
          }
        }

        if(node.mesh === undefined) continue;
        let mesh = glTF.meshes[node.mesh];
        
        for(const primitive of mesh.primitives){
          // create material
          let material:GPUMaterial;
          // create default values for parameters, then
          // update defaults if the attributes are 
          // available
          let baseColorFactor = new Float32Array([1.0,1.0,1.0,1.0]);
          let baseColorTextureId = -1;
          let roughnessFactor = 1.0;
          let metallicFactor = 1.0;
          let metallicRoughnessTextureId = -1;

          if(primitive.material !== undefined){
            let glTFMaterial = glTF.materials[primitive.material];
            if(glTFMaterial.pbrMetallicRoughness !== undefined){
              if(glTFMaterial.pbrMetallicRoughness.baseColorFactor !== undefined){
                baseColorFactor = new Float32Array(glTFMaterial.pbrMetallicRoughness.baseColorFactor);
              };
              if(glTFMaterial.pbrMetallicRoughness.baseColorTexture !== undefined){
                baseColorTextureId = glTFMaterial.pbrMetallicRoughness.baseColorTexture.index;
              }
              if(glTFMaterial.pbrMetallicRoughness.metallicFactor !== undefined){
                metallicFactor = glTFMaterial.pbrMetallicRoughness.metallicFactor;
              }
              if(glTFMaterial.pbrMetallicRoughness.roughnessFactor !== undefined){
                roughnessFactor = glTFMaterial.pbrMetallicRoughness.roughnessFactor;
              }
              if(glTFMaterial.pbrMetallicRoughness.metallicRoughnessTexture !== undefined){
                metallicRoughnessTextureId = glTFMaterial.pbrMetallicRoughness.metallicRoughnessTexture.index;
              }
            }
            if(glTFMaterial.extensions?.KHR_materials_transmission !== undefined){
              let glTFtransmission = glTFMaterial.extensions.KHR_materials_transmission;
              // initialize default properties for KHR_materials_transmission
              let transmissionFactor = 0.0;
              let transmissionTextureId = -1;
              if(glTFtransmission.transmissionFactor!==undefined){
                transmissionFactor = glTFtransmission.transmissionFactor;
              }
              if(glTFtransmission.transmissionTexture !== undefined){
                transmissionTextureId = glTFtransmission.transmissionTexture.index;
              }
              if(glTFMaterial.extensions.KHR_materials_volume !== undefined){
                let glTFVolume = glTFMaterial.extensions.KHR_materials_volume;
                // initialize default properties for KHR_materials_volume
                let thicknessFactor = 0.0;
                let thicknessTextureId = -1;
                let attenuationDistance = MAX_FLOAT32;
                let attenuationColor = new Float32Array([1.0,1.0,1.0]);
                if(glTFVolume.thicknessFactor!==undefined){
                  thicknessFactor = glTFVolume.thicknessFactor;
                }
                if(glTFVolume.thicknessTexture!==undefined){
                  thicknessTextureId = glTFVolume.thicknessTexture.index;
                }
                if(glTFVolume.attenuationDistance!==undefined){
                  attenuationDistance = glTFVolume.attenuationDistance;
                }
                if(glTFVolume.attenuationColor!==undefined){
                  attenuationColor = new Float32Array(glTFVolume.attenuationColor);
                }
                material = new GPUMaterialVolume(
                  baseColorFactor,
                  baseColorTextureId,
                  metallicFactor,
                  roughnessFactor,
                  metallicRoughnessTextureId,
                  transmissionFactor,
                  transmissionTextureId,
                  attenuationDistance,
                  attenuationColor,
                  this.device
                );
              }
              else{
                material = new GPUMaterialTransmission(
                  baseColorFactor,
                  baseColorTextureId,
                  metallicFactor,
                  roughnessFactor,
                  metallicRoughnessTextureId,
                  transmissionFactor,
                  transmissionTextureId,
                  this.device
                );
              }
            }
            else{
              material = new GPUMaterialBase(
                baseColorFactor,
                baseColorTextureId,
                metallicFactor,
                roughnessFactor,
                metallicRoughnessTextureId,
                this.device
              );
            }
          }
          else{
            material = new GPUMaterialBase(
              baseColorFactor,
              baseColorTextureId,
              metallicFactor,
              roughnessFactor,
              metallicRoughnessTextureId,
              this.device
            );
          }


          
          // create modelMatrix
          let modelMatrix = this.device.createBuffer({
            size: 4 * 4 * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            mappedAtCreation:true
          });
          let normalMatrix = this.device.createBuffer({
            size: 4 * 4 * 4,
            usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            mappedAtCreation:true
          })
    
          new Float32Array(modelMatrix.getMappedRange()).set(transforms.get(i)!);
          new Float32Array(normalMatrix.getMappedRange())
            .set(Matrix.inverseTranspose(transforms.get(i)!));
          modelMatrix.unmap();
          normalMatrix.unmap();
          
          // position
          let positionAccessor = glTF.accessors[primitive.attributes.POSITION];
          let positionBuffer = this.device.createBuffer({
            size: positionAccessor.count * 3 * 4,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation:true
          });
          let byteOffset = 0;
          if(positionAccessor.byteOffset) byteOffset = positionAccessor.byteOffset;
          // this is the memory mapped to the buffer as a Uint8Array
          // (that allows byte level operations)
          let dst = new Uint8Array(positionBuffer.getMappedRange());
          // the memory to copy to the buffer
          let src = new Uint8Array(bufferViews[positionAccessor.bufferView!],byteOffset, 3 * 4 * positionAccessor.count);
          dst.set(src);
          positionBuffer.unmap();

          // normal
          let normalAccessor = glTF.accessors[primitive.attributes.NORMAL];
          let normalBuffer = this.device.createBuffer({
            size: normalAccessor.count * 3 * 4,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            mappedAtCreation:true
          });
          byteOffset = 0;
          if(normalAccessor.byteOffset) byteOffset = normalAccessor.byteOffset;
          // this is the memory mapped to the buffer as a Uint8Array
          // (that allows byte level operations)
          dst = new Uint8Array(normalBuffer.getMappedRange());
          // the memory to copy to the buffer
          src = new Uint8Array(bufferViews[normalAccessor.bufferView!],byteOffset, 3 * 4 * normalAccessor.count);
          dst.set(src);
          normalBuffer.unmap();

          // uvs
          let uvBuffer:GPUBuffer;
          if(primitive.attributes.TEXCOORD_0 !== undefined){
            let uvAccessor = glTF.accessors[primitive.attributes.TEXCOORD_0];
            uvBuffer = this.device.createBuffer({
              size:uvAccessor.count * 2 * 4,
              usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
              mappedAtCreation:true
            });
            byteOffset = 0;
            if(uvAccessor.byteOffset) byteOffset = uvAccessor.byteOffset;
            dst = new Uint8Array(uvBuffer.getMappedRange());
            src = new Uint8Array(bufferViews[uvAccessor.bufferView!],byteOffset,2*4*uvAccessor.count);
            dst.set(src);
            uvBuffer.unmap();
          }
          else{
            // if there is no TEXCOORD_0 attribute, as a
            // placeholder set all the uv coords to (0.,0.)
            uvBuffer = this.device.createBuffer({
              size:positionAccessor.count * 2 * 4,
              usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
              mappedAtCreation:true
            });
            byteOffset = 0;
            dst = new Uint8Array(uvBuffer.getMappedRange());
            src = new Uint8Array(2*4*positionAccessor.count);
            dst.set(src);
            uvBuffer.unmap();    
          }
    
          // index
          if(primitive.indices !== undefined){
            let indexAccessor = glTF.accessors[primitive.indices];
            let indexSize:number;
            let indexFormat:GPUIndexFormat;
            switch(indexAccessor.componentType){
              case GLTFComponentType.UNSIGNED_INT:{
                indexSize = 4;
                indexFormat = <GPUIndexFormat>'uint32';
                src = new Uint8Array(bufferViews[indexAccessor.bufferView!],byteOffset, indexSize * indexAccessor.count);
                break;
              }
              case GLTFComponentType.UNSIGNED_SHORT:{
                indexSize = 2;
                indexFormat = <GPUIndexFormat>'uint16';
                src = new Uint8Array(bufferViews[indexAccessor.bufferView!],byteOffset, indexSize * indexAccessor.count);
                break;
              }
              case GLTFComponentType.UNSIGNED_BYTE:{
                indexSize = 2;
                indexFormat = <GPUIndexFormat>'uint16';
                let tmp = new Uint8Array(bufferViews[indexAccessor.bufferView!],byteOffset, indexAccessor.count);
                let tmp2 = new Uint16Array(indexAccessor.count);
                for(let i=0;i<indexAccessor.count;i++){
                  tmp2[i] = tmp[i];
                }
                src = new Uint8Array(tmp2.buffer,0,indexSize * indexAccessor.count);
                break;
              }
              default:{
                throw Error("Unknown component type");
              }
            }
            let indexBuffer = this.device.createBuffer({
              size: GPUScene.alignTo4Bytes(indexAccessor.count * indexSize),
              usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
              mappedAtCreation:true
            });
            byteOffset = 0;
            if(indexAccessor.byteOffset) byteOffset = indexAccessor.byteOffset;
    
            dst = new Uint8Array(indexBuffer.getMappedRange());
            dst.set(src);
            indexBuffer.unmap();

            let mesh = new GPUIndexedMesh(
              positionAccessor.count,
              positionBuffer,
              normalBuffer,
              modelMatrix,
              normalMatrix,
              uvBuffer,
              material,
              indexAccessor.count,
              indexFormat,
              indexBuffer
            );
            if(mesh.material instanceof GPUMaterialVolume){
              this.volumeMeshes.push(mesh);
            }
            else if(mesh.material instanceof GPUMaterialTransmission){
              this.transmissionMeshes.push(mesh);
            }
            else{
              this.opaqueMeshes.push(mesh);
            }

          }
          else{
            let mesh =new GPUMesh(
              positionAccessor.count,
              positionBuffer,
              normalBuffer,
              modelMatrix,
              normalMatrix,
              uvBuffer,
              material
            );
            if(mesh.material instanceof GPUMaterialVolume){
              this.volumeMeshes.push(mesh);
            }
            else if(mesh.material instanceof GPUMaterialTransmission){
              this.transmissionMeshes.push(mesh);
            }
            else{
              this.opaqueMeshes.push(mesh);
            }
          }
        }
      }
    }
  
    public async load(){
      await this.initialize();
      this.loaded=true;
    }

    private static computeTransforms(nodes:GlTFTypes.GlTFNode[]) : Map<number,Float32Array>{
      let transforms = new Map<number,Float32Array>();
      nodes.forEach((node:GlTFTypes.GlTFNode,item:number) =>{

          let transform:Float32Array;
          if(node.matrix){
            transform = new Float32Array(node.matrix);
          }
          else{
            transform = Matrix.id();
            if(node.scale) transform = Matrix.multiplyMatrices(Matrix.scaleMatrix(node.scale[0],node.scale[1],node.scale[2]),transform);
            if(node.rotation) transform = Matrix.multiplyMatrices(Matrix.quaternionToMatrix(node.rotation[0],node.rotation[1],node.rotation[2],node.rotation[3]),transform);
            if(node.translation) transform = Matrix.multiplyMatrices(Matrix.translationMatrix(node.translation[0],node.translation[1],node.translation[2]),transform);
          }
          transforms.set(item,transform);

      });
      return transforms;
    }
  
    private static traverse(currentNode:GlTFTypes.GlTFNode, nodes: GlTFTypes.GlTFNode[], transforms:Map<number,Float32Array>, currentId:number, parentId:number){
      // currentId is equal to parentId only in the 
      // root node
      if(currentId != parentId){
        transforms.set(currentId,Matrix.multiplyMatrices(transforms.get(parentId)!, transforms.get(currentId)!));
      }
      if(currentNode.children){
        for(let childId of currentNode.children){
          GPUScene.traverse(nodes[childId],nodes,transforms,childId,currentId);
        }
      }
    }

    private static alignTo4Bytes(size:number){
      return Math.ceil((size) / 4) * 4;
    }
  
  }
  