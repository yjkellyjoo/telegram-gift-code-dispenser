/** Private key n as 32-byte hex: 0x…01, 0x…02, … Valid secp256k1 keys with well-known addresses. */
export const key = (n: number): string => `0x${n.toString(16).padStart(64, '0')}`;

/** Addresses of key(1), key(2), key(3), derived independently of the code under test. */
export const ADDRESS_1 = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
export const ADDRESS_2 = '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF';
export const ADDRESS_3 = '0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69';

/** Hardhat's well-known accounts #0 and #1. */
export const HARDHAT_0 = {
  privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
};
export const HARDHAT_1 = {
  privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
};
