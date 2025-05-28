import { ethers } from 'ethers';
import { withHexPrefix, asBigInt } from "@/utils/index";

function nextBytes(buf, n) {
  return [buf.slice(0, n), buf.slice(n)]
}

function nextVarInt(buf) {
  const first = buf[0]
  let value
  let length

  if (first < 0xfd) {
    value = first
    length = 1
  } else if (first === 0xfd) {
    value = buf.readUInt16LE(1)
    length = 3
  } else if (first === 0xfe) {
    value = buf.readUInt32LE(1)
    length = 5
  } else {
    value = Number(buf.readBigUInt64LE(1))
    length = 9
  }

  return [value, buf.slice(0, length), buf.slice(length)]
}

function splitTransaction(txHex) {
  let buf = Buffer.from(txHex, 'hex')
  let version
  let flag
  let vin
  let vout
  let witness
  let locktime

    // Version
  ;[version, buf] = nextBytes(buf, 4)

  // Optional Segwit Marker and Flag or Input Count
  let inputCount
  let inputCountBuf
  ;[inputCount, inputCountBuf, buf] = nextVarInt(buf)
  if (inputCount === 0) {
    ;([flag, buf] = nextBytes(buf, 1)),
      (flag = Buffer.concat([inputCountBuf, flag])),
      ([inputCount, inputCountBuf, buf] = nextVarInt(buf))
  } else {
    flag = Buffer.from([])
  }

  // Start tracking vin
  let vinBuf = inputCountBuf
  for (let i = 0; i < inputCount; i++) {
    let txid
    let voutIndex
    let scriptLen
    let scriptLenBuf
    let script
    let sequence
    ;([txid, buf] = nextBytes(buf, 32)),
      ([voutIndex, buf] = nextBytes(buf, 4)),
      ([scriptLen, scriptLenBuf, buf] = nextVarInt(buf)),
      ([script, buf] = nextBytes(buf, scriptLen)),
      ([sequence, buf] = nextBytes(buf, 4)),
      (vinBuf = Buffer.concat([vinBuf, txid, voutIndex, scriptLenBuf, script, sequence]))
  }
  vin = vinBuf

  // Outputs
  let outCount
  let outCountBuf
  ;[outCount, outCountBuf, buf] = nextVarInt(buf)
  let voutBuf = outCountBuf
  for (let i = 0; i < outCount; i++) {
    let amount
    let scriptLen
    let scriptLenBuf
    let script
    ;([amount, buf] = nextBytes(buf, 8)),
      ([scriptLen, scriptLenBuf, buf] = nextVarInt(buf)),
      ([script, buf] = nextBytes(buf, scriptLen)),
      (voutBuf = Buffer.concat([voutBuf, amount, scriptLenBuf, script]))
  }
  vout = voutBuf

  // Witnesses
  witness = Buffer.alloc(0)
  if (flag.length > 0) {
    let witnessBuf = Buffer.alloc(0)
    for (let i = 0; i < inputCount; i++) {
      let compCount
      let compCountBuf
      ;[compCount, compCountBuf, buf] = nextVarInt(buf)
      witnessBuf = Buffer.concat([witnessBuf, compCountBuf])
      for (let c = 0; c < compCount; c++) {
        let l
        let component
        let varintBuf
        ;([l, varintBuf, buf] = nextVarInt(buf)),
          ([component, buf] = nextBytes(buf, l)),
          (witnessBuf = Buffer.concat([witnessBuf, varintBuf, component]))
      }
    }
    witness = witnessBuf
  }

  // Locktime
  ;[locktime, buf] = nextBytes(buf, 4)

  // Assert the buffer is empty
  if (buf.length !== 0) {
    throw new Error('Error parsing transaction: buffer not empty.')
  }

  return {
    version,
    flag,
    vin,
    vout,
    witness,
    locktime,
  }
}

export async function getTransactionParams(txid, blockHeight) {
  let response = await fetch(
    `https://mempool.space/signet/api/tx/${txid}/hex`
  );
  let hex = await response.text();
  const splittedTx = splitTransaction(hex)
  response = await fetch(
    `https://mempool.space/signet/api/tx/${txid}/merkle-proof`
  ); 
  const proofData = await response.json();
  const proof = Array.isArray(proofData.merkle)
    ? proofData.merkle.map(node => {
        const buffer = Buffer.from(node, 'hex');
        // Reverse the buffer to change endianness
        return Buffer.from(buffer).reverse();
      })
    : [];
  console.log(proofData);
  const index = proofData.pos;

  return {
    version: withHexPrefix(splittedTx.version.toString('hex')),
    vin: withHexPrefix(splittedTx.vin.toString('hex')),
    vout: withHexPrefix(splittedTx.vout.toString('hex')),
    locktime: withHexPrefix(splittedTx.locktime.toString('hex')),
    intermediateNodes: withHexPrefix(Buffer.concat(proof).toString('hex')),
    blockHeight: asBigInt(blockHeight),
    index: asBigInt(index),
  }
}

export async function getTransactionParamsEncoded(txid, blockHeight, borrowerAddress, blockHeader) {
  const tp = await getTransactionParams(txid, blockHeight)
  const abi = new ethers.AbiCoder()
  const encodedData = abi.encode(
    [
      'address borrower_address',
      'tuple(bytes4 version,bytes vin,bytes vout,bytes4 locktime,bytes intermediate_nodes,uint256 block_height,uint256 index)',
      'bytes block_header',
    ],
    [borrowerAddress, tp, blockHeader]
  )
  return encodedData
}

export default {
  getTransactionParams,
  getTransactionParamsEncoded,
};
