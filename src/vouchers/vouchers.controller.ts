import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { VouchersService } from './vouchers.service';

@Controller('api/vouchers')
export class VouchersController {
  constructor(private vouchersService: VouchersService) {}

  @Get()
  async getAll() {
    return this.vouchersService.getAll();
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.vouchersService.getById(id);
  }

  @Post()
  async create(@Body() data: any) {
    return this.vouchersService.create(data);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.vouchersService.update(id, data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.vouchersService.delete(id);
  }
}
