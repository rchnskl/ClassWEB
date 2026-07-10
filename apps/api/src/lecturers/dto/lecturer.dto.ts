import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

export class CreateLecturerDto {
  @ApiProperty({ example: 'EMP-0002' })
  @IsString()
  @MinLength(2)
  employeeCode!: string;

  @ApiProperty({ example: 'Dr. Naree Chaisri' })
  @IsString()
  @MinLength(1)
  nameEn!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  nameTh?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  position?: string;

  @ApiProperty({ description: 'Also used as the login email for the account created alongside this lecturer' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  office?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentId?: string;
}

export class QueryLecturerDto extends PaginationQueryDto {}

// All fields optional for PATCH; employeeCode can be updated too.
export class UpdateLecturerDto extends PartialType(CreateLecturerDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
