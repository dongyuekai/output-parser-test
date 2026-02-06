import 'dotenv/config';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import mysql from 'mysql2/promise';

// 初始化模型
const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME,
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

// 定义单个好友信息的 zod schema，匹配 friends 表结构
const friendSchema = z.object({
  name: z.string().describe('姓名'),
  gender: z.string().describe('性别（男/女）'),
  birth_date: z.string().describe('出生日期，格式：YYYY-MM-DD，如果无法确定具体日期，根据年龄估算'),
  company: z.string().nullable().optional().describe('公司名称，如果没有则返回 null'),
  title: z.string().nullable().optional().describe('职位/头衔，如果没有则返回 null'),
  phone: z.string().nullable().optional().describe('手机号，如果没有则返回 null'),
  wechat: z.string().nullable().optional().describe('微信号，如果没有则返回 null'),
});

// 定义批量好友信息的 schema（数组）
const friendsArraySchema = z.array(friendSchema).describe('好友信息数组');

// 使用withStructuredOutput方法，告诉模型返回符合 schema 的内容
const structuredModel = model.withStructuredOutput(friendsArraySchema);

// 数据库连接配置
const connectionConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: process.env.MYSQL_PORT,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
};

async function extractAndInsert(text) {
  const connection = await mysql.createConnection(connectionConfig);
  try {
    // 切换到 hello 数据库
    await connection.query(`USE hello;`);

    // 使用AI提取结构化信息
    console.log('🤔 正在从文本中提取信息...\n');
    const prompt = `请从以下文本中提取所有好友信息，并返回符合指定JSON格式的数据。

文本内容：
${text}

请提取每个人的信息，返回一个JSON数组。每个对象必须包含以下字段（用英文字段名）：
- name: 姓名（必填）
- gender: 性别，值为"男"或"女"（必填）
- birth_date: 出生日期，格式为YYYY-MM-DD，如果无法确定具体日期则根据年龄描述估算（必填）
- company: 公司名称（选填，没有则为null）
- title: 职位/头衔（选填，没有则为null）
- phone: 手机号（选填，没有则为null）
- wechat: 微信号（选填，没有则为null）

示例JSON格式：
[
  {
    "name": "张总",
    "gender": "女",
    "birth_date": "1993-01-01",
    "company": "腾讯",
    "title": "技术总监",
    "phone": "13800138000",
    "wechat": "zhangzong2024"
  }
]

请严格按照这个格式返回JSON数组，即使只有一个人也要放在数组中。`;
    const results = await structuredModel.invoke(prompt);

    console.log(`✅ 提取到 ${results.length} 条结构化信息:`);
    console.log(JSON.stringify(results, null, 2));
    console.log('');

    if (results.length === 0) {
      console.log('⚠️  没有提取到任何信息');
      return { count: 0, insertIds: [] };
    }
    // 批量插入数据库
    const insertSql = `
        INSERT INTO friends (
        name,
        gender,
        birth_date,
        company,
        title,
        phone,
        wechat
        ) VALUES ?;
 `;
    const values = results.map((result) => [
      result.name,
      result.gender,
      result.birth_date || null,
      result.company,
      result.title,
      result.phone,
      result.wechat,
    ]);

    const [insertResult] = await connection.query(insertSql, [values]);
    console.log(`✅ 成功批量插入 ${insertResult.affectedRows} 条数据`);
    console.log(`   插入的ID范围：${insertResult.insertId} - ${insertResult.insertId + insertResult.affectedRows - 1}`);

    return {
      count: insertResult.affectedRows,
      insertIds: Array.from({ length: insertResult.affectedRows }, (_, i) => insertResult.insertId + i),
    };

  } catch (error) {
    console.error('数据库操作出错：', error);
    throw error
  } finally {
    await connection.end();
  }
}

// 主函数
async function main() {
  // 示例文本（包含多个人的信息）
  const sampleText = `我最近认识了几个新朋友。第一个是张总，女的，看起来30出头，在腾讯做技术总监，手机13800138000，微信是zhangzong2024。第二个是李工，男，大概28岁，在阿里云做架构师，电话15900159000，微信号lee_arch。还有一个是陈经理，女，35岁左右，在美团做产品经理，手机号是18800188000，微信chenpm2024。`;
  console.log('📝 输入文本:');
  console.log(sampleText);
  console.log('');
  try {
    const result = await extractAndInsert(sampleText);
    console.log(`✅ 成功插入 ${result.count} 条数据，插入ID列表：`, result.insertIds);
  } catch (error) {
    console.error('处理失败：', error);
    process.exit(1);
  }
}
main()
