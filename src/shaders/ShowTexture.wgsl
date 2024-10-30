@group(0) @binding(0) var<uniform> iResolution: vec2f;
@group(0) @binding(1) var basicSampler:sampler;

@group(1) @binding(0) var inputTexture: texture_2d<f32>;

override showR:f32 = 1.0;
override showG:f32 = 1.0;
override showB:f32 = 1.0;
override showA:f32 = 1.0;

@vertex
fn vs(@builtin(vertex_index) index:u32) -> @builtin(position) vec4<f32> {
    let pos = array(
        vec2f(-1.0, -1.0),   // bottom left
        vec2f( 1.0, -1.0),   // bottom right
        vec2f(-1.0,  1.0),   // top left
        vec2f(-1.0,  1.0),   // top left
        vec2f( 1.0,  1.0),   // top right
        vec2f( 1.0, -1.0),   // bottom right
    );
    return vec4f(pos[index],0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fragCoord:vec4f) -> @location(0) vec4<f32> {
    
    let color = textureLoad(inputTexture,vec2<i32>(i32(fragCoord.x),i32(fragCoord.y)),0);
    let r = color.r;
    let g = color.g;
    let b = color.b;
    let a = color.a;
    if(showR <= 0 && showG <= 0 && showB <= 0 && showA > 0){    // 0 0 0 1
        return vec4f(a,a,a,a);
    }
    if(showR <= 0 && showG <= 0 && showB > 0 && showA <= 0){    // 0 0 1 0
        return vec4f(b,b,b,b);
    }
    if(showR <= 0 && showG <= 0 && showB > 0 && showA > 0){    // 0 0 1 1
        return vec4f(0.0,0.0,b,a);
    }
    if(showR <= 0 && showG > 0 && showB <= 0 && showA <= 0){    // 0 1 0 0
        return vec4f(b,b,b,b);
    }
    if(showR <= 0 && showG > 0 && showB <= 0 && showA > 0){    // 0 1 0 1
        return vec4f(0.0,g,0,a);
    }
    if(showR <= 0 && showG > 0 && showB > 0 && showA <= 0){    // 0 1 1 0
        return vec4f(0.0,g,b,0);
    }
    if(showR <= 0 && showG > 0 && showB > 0 && showA > 0){    // 0 1 1 1
        return vec4f(0,g,b,a);
    }
    if(showR > 0 && showG <= 0 && showB <= 0 && showA <= 0){    // 1 0 0 0
        return vec4f(r,r,r,r);
    }
    if(showR > 0 && showG <= 0 && showB <= 0 && showA > 0){    // 1 0 0 1
        return vec4f(r,0,0,a);
    }
    if(showR > 0 && showG <= 0 && showB > 0 && showA <= 0){    // 1 0 1 0
        return vec4f(r,0,b,0);
    }
    if(showR > 0 && showG <= 0 && showB > 0 && showA > 0){    // 1 0 1 1
        return vec4f(r,0,b,a);
    }
    if(showR > 0 && showG > 0 && showB <= 0 && showA <= 0){    // 1 1 0 0
        return vec4f(r,g,0,0);
    }
    if(showR > 0 && showG > 0 && showB <= 0 && showA > 0){    // 1 1 0 1
        return vec4f(r,g,0,a);
    }
    if(showR > 0 && showG > 0 && showB > 0 && showA <= 0){    // 1 1 1 0
        return vec4f(r,g,b,0);
    }

    return color;
}
