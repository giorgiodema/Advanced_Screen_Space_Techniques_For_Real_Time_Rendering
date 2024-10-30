// Physically based shading model
// parameterized with the below options
// [ Karis 2013, "Real Shading in Unreal Engine 4" slide 11 ]
// https://cdn2.unrealengine.com/Resources/files/2013SiggraphPresentationsNotes-26915738.pdf

// E = Random sample for BRDF.
// N = Normal of the macro surface.
// H = Normal of the micro surface.
// V = View vector going from surface's position towards the view's origin.
// L = Light ray direction

// D = Microfacet NDF
// G = Shadowing and masking
// F = Fresnel

// a2 = Roughness * Roughness

// Vis = G / (4*NoL*NoV)
// f = Microfacet specular BRDF = D*G*F / (4*NoL*NoV) = D*Vis*F

const PI = 3.14159;

fn Diffuse_Lambert(DiffuseColor:vec3f) -> vec3f
{
	return DiffuseColor * (1.0 / PI);
}

// GGX / Trowbridge-Reitz
// [Walter et al. 2007, "Microfacet models for refraction through rough surfaces"]
fn D_GGX( a2:f32, NoH:f32 ) -> f32
{
	let d = ( NoH * a2 - NoH ) * NoH + 1.0;	// 2 mad
	return a2 / ( PI*d*d );					// 4 mul, 1 rcp
}

// Tuned to match behavior of Vis_Smith
// [Schlick 1994, "An Inexpensive BRDF Model for Physically-Based Rendering"]
fn Vis_Schlick( a2:f32, NoV:f32, NoL:f32 ) -> f32
{
	let k = sqrt(a2) * 0.5;
	let Vis_SchlickV = NoV * (1.0 - k) + k;
	let Vis_SchlickL = NoL * (1.0 - k) + k;
	return 0.25 / ( Vis_SchlickV * Vis_SchlickL );
}

// [Schlick 1994, "An Inexpensive BRDF Model for Physically-Based Rendering"]
fn F_Schlick( SpecularColor:vec3f, VoH:f32 ) -> vec3f
{
	let Fc = pow( 1.0 - VoH , 5.0 );
	return saturate( 50.0 * SpecularColor.g ) * Fc + (1.0 - Fc) * SpecularColor;
}

fn Vis_SmithTransmission(a2:f32, NoV:f32, NoT:f32, HoT:f32, HoV:f32 ) -> f32
{
    let d1 = NoT + sqrt(a2 + (1-a2)*NoT*NoT);
    let d2 = NoV + sqrt(a2 + (1-a2)*NoV*NoV);
    let n1 = 2 * NoT * saturate(HoT/NoT);
    let n2 = 2 * NoV * saturate(HoV/NoV);
    return (n1/d1) * (n2/d2) / (4.0 * NoT * NoV);
}

fn Vis_Refraction(a2:f32, NoV:f32, NoT:f32, HoT:f32, HoV:f32,ni:f32,no:f32 ) -> f32
{
    let d1 = NoT + sqrt(a2 + (1-a2)*NoT*NoT);
    let d2 = NoV + sqrt(a2 + (1-a2)*NoV*NoV);
    let n1 = 2 * NoT * saturate(HoT/NoT);
    let n2 = 2 * NoV * saturate(HoV/NoV);
    let normalization = ((HoT*HoV)/(NoT*NoV)) * ((no*no)/pow(ni*HoV + no*HoT,2));
    return normalization * (n1/d1) * (n2/d2);
}

//--------------------------------------------
// glTF BRDF Implementation: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#appendix-b-brdf-implementation
//--------------------------------------------
fn DiffuseBRDF(DiffuseColor:vec3f) -> vec3f
{
    return Diffuse_Lambert(DiffuseColor);
}

fn SpecularBRDF(a2:f32,NoH:f32,NoV:f32,NoL:f32) -> vec3f
{
    return vec3f(D_GGX(a2,NoH) * Vis_Schlick(a2,NoV,NoL));
}

fn conductorFresnel(F0:vec3f, bsdf:vec3f,VoH:f32) -> vec3f
{
    return bsdf * (F0 + (1.0 - F0) * pow(1.0 - abs(VoH),5.0));
}

fn fresnelMix(ior:f32, base:vec3f, layer:vec3f, VoH:f32) -> vec3f
{
    let F0 = pow((1.0-ior)/(1.0+ior),2.0);
    let FR = F0 + (1.0 - F0) * pow(1.0 - abs(VoH),5.0);
    return mix(base,layer,FR);
}

fn metalBRDF(baseColor:vec3f,a2:f32,NoH:f32,NoV:f32,NoL:f32,VoH:f32)->vec3f
{
    let specular =  SpecularBRDF(a2,NoH,NoV,NoL);
    return conductorFresnel(baseColor,specular,VoH);
}

fn dielectricBRDF(baseColor:vec3f,ior:f32,a2:f32,NoH:f32,NoV:f32,NoL:f32,VoH:f32)->vec3f
{
    let specular =  SpecularBRDF(a2,NoH,NoV,NoL);
    let diffuse = DiffuseBRDF(baseColor);
    return fresnelMix(ior,diffuse,specular,VoH);
}

fn surfaceBRDF(metallic:f32,baseColor:vec3f,ior:f32,a2:f32,NoH:f32,NoV:f32,NoL:f32,VoH:f32)->vec3f
{

    let mBRDF = metalBRDF(baseColor,a2,NoH,NoV,NoL,VoH);
    let dBRDF = dielectricBRDF(baseColor,ior,a2,NoH,NoV,NoL,VoH);
    return mix(dBRDF,mBRDF,metallic);
}
