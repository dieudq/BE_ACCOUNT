import { Controller, Post, UseInterceptors, UploadedFile, BadRequestException, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as path from 'path';
import type { Response } from 'express';
import type { Express } from 'express';
import { GLFileProcessorService } from './gl-file-processor.service';

@Controller('api/exports')
export class FileUploadController {
  constructor(private glProcessor: GLFileProcessorService) {}

  /**
   * POST /api/exports/upload-gl-file
   * Upload GL Detail Excel file → Parse → Generate Cashflow Excel
   */
  @Post('upload-gl-file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadDir = path.join(process.cwd(), 'uploads');
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          const filename = `gl_${Date.now()}_${file.originalname}`;
          cb(null, filename);
        },
      }),
      fileFilter: (req, file, cb) => {
        // Only accept Excel files
        const allowedMimes = [
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-excel',
        ];

        if (allowedMimes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(null, false);
        }
      },
    }),
  )
  async uploadGLFile(
    @UploadedFile() file: any,
    @Res() res?: Response,
  ) {
    try {
      if (!file) {
        if (res) {
          res.status(400).json({
            success: false,
            error: 'No file uploaded or invalid file type. Only Excel files allowed (.xlsx, .xls)',
          });
        }
        return;
      }

      console.log(`📥 Received file: ${file.originalname} (${file.size} bytes)`);

      // Process GL file and generate Cashflow
      const coaPath = path.join(process.cwd(), 'templates/Danh_sach_he_thong_tai_khoan.xlsx');
      const outputPath = await this.glProcessor.processGLFileAndGenerateCashflow(
        file.path,
        coaPath,
      );

      // Send file as download
      if (res) {
        const filename = path.basename(outputPath);
        res.download(outputPath, filename, (err) => {
          if (err) {
            console.error('Download error:', err);
          }
        });
      }
    } catch (err) {
      const errorMsg = (err as Error).message;
      console.error('Upload error:', errorMsg);
      if (res) {
        res.status(500).json({
          success: false,
          error: errorMsg,
        });
      }
    }
  }

  /**
   * GET /api/exports/upload-gl-file/help
   * API usage instructions
   */
  @Post('upload-gl-file/help')
  async getHelpInfo() {
    return {
      description: 'Upload GL Detail Excel file and generate Cashflow report',
      endpoint: 'POST /api/exports/upload-gl-file',
      method: 'multipart/form-data',
      parameters: {
        file: {
          type: 'File (Excel .xlsx or .xls)',
          description: 'GL Account Detail spreadsheet with columns: Ngày hạch toán | Ngày chứng từ | Số chứng từ | Diễn giải | TK đối ứng | Phát sinh Nợ | Phát sinh Có',
        },
      },
      response: {
        success: true,
        file: 'Generated Cashflow Excel file (download)',
      },
      example: `
curl -X POST "http://localhost:3000/api/exports/upload-gl-file" \\
  -F "file=@So_chi_tiet_cac_tai_khoan.xlsx"
      `,
    };
  }
}
