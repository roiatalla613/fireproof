/* eslint-disable import/first */
// console.log('import store-s3')

import { Connection, DownloadFnParams, UploadFnParams } from './types'
import fetch from 'cross-fetch'

export class ConnectS3 implements Connection {
  uploadUrl: URL
  downloadUrl: URL
  ready: Promise<any> = Promise.resolve()

  constructor(upload: string, download: string) {
    this.uploadUrl = new URL(upload)
    this.downloadUrl = new URL(download)
  }

  validateParams(params: DownloadFnParams | UploadFnParams) {
    const { type, name, car, branch } = params
    if (!name) throw new Error('name is required')
    if (car && branch) { throw new Error('car and branch are mutually exclusive') }
    if (!car && !branch) { throw new Error('car or branch is required') }
    if (type !== 'data' && type !== 'meta') { throw new Error('type must be data or meta') }
  }

  async upload(bytes: Uint8Array, params: UploadFnParams) {
    this.validateParams(params)
    const response = await fetch(new URL(`${this.uploadUrl.toString()}?${new URLSearchParams(params).toString()}`))
    const { uploadURL } = await response.json() as { uploadURL: string }
    await fetch(uploadURL, { method: 'PUT', body: bytes })
  }

  async download(params: DownloadFnParams) {
    console.log('download', params, this)
    this.validateParams(params)
    const { type, name, car, branch } = params
    const response = await fetch(new URL(`${type}/${name}/${type === 'data'
      ? car + '.car'
      : branch + '.json'}`, this.downloadUrl))
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes
  }
}
