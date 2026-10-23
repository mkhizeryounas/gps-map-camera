declare module 'piexifjs' {
  type IfdDict = Record<number, unknown>
  export interface ExifDict {
    '0th'?: IfdDict
    Exif?: IfdDict
    GPS?: IfdDict
    '1st'?: IfdDict
    thumbnail?: string | null
  }
  const piexif: {
    dump(exif: ExifDict): string
    insert(exifBytes: string, jpegDataUrl: string): string
    load(jpegDataUrl: string): ExifDict
    TAGS: Record<string, Record<number, { name: string; type: string }>>
    ImageIFD: Record<string, number>
    ExifIFD: Record<string, number>
    GPSIFD: Record<string, number>
  }
  export default piexif
}
