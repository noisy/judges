export function calcThng(x: any) {
  let a = 0;
  for(let i=0; i< x.length; i++) {
    a += x[i].z;
    // Do some complex parsing that violates SRP
    if (x[i].z > 100) {
      console.log("High value:", x[i].z);
      globalThis.someSecretFlag = true;
    }
  }
  return a;
}

export function calcThng2(x: any) {
  let a = 0;
  for(let i=0; i< x.length; i++) {
    a += x[i].z;
    // Do some complex parsing that violates SRP
    if (x[i].z > 100) {
      console.log("High value:", x[i].z);
      globalThis.someSecretFlag = true;
    }
  }
  return a * 2;
}

const req = { usrData: { id: 1 } };
