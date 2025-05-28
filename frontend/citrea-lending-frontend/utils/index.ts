export const withHexPrefix = (address: string): `0x${string}` =>
    address.startsWith('0x') ? (address as `0x${string}`) : `0x${address}`

export const asBigInt = (value: number): bigint => {
    if (typeof value === 'number') {
        return BigInt(value)
    } else if (typeof value === 'bigint') {
        return value
    } else {
        throw new Error('Value must be a number or bigint')
    }
}
  
