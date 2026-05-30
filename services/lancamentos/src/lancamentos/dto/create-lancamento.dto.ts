import { IsEnum, IsNumber, IsPositive, IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';
import { TipoLancamento } from '../entities/lancamento.entity';

export class CreateLancamentoDto {
  @IsEnum(TipoLancamento, { message: 'tipo deve ser DEBITO ou CREDITO' })
  tipo: TipoLancamento;

  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'valor deve ter no máximo 2 casas decimais' })
  @IsPositive({ message: 'valor deve ser positivo' })
  valor: number;

  @IsDateString({}, { message: 'data deve estar no formato YYYY-MM-DD' })
  data: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  descricao?: string;
}
