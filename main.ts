import { App, Plugin, PluginSettingTab, Setting, Notice, Platform } from 'obsidian';
import * as fs from 'fs';
import * as path from 'path';

// 插件设置接口
interface FolderCreatorSettings {
    basePath: string;           // 用户填写的绝对路径
    treeStructure: string;      // 树形结构的文本
    createType: 'folder' | 'file' | 'tree';  // 创建类型：文件夹、md文件、树形结构
}

// 默认设置
const DEFAULT_SETTINGS: FolderCreatorSettings = {
    basePath: '',
    treeStructure: '',
    createType: 'tree'
}

// 定义非法文件名字符的正则
const INVALID_CHARS_REGEX = /[\\/:*?"<>|\x00-\x1f]/;

// 定义树形节点接口
interface TreeNode {
    name: string;
    isFile: boolean;
    children: Map<string, TreeNode>;
}

export default class FolderCreatorPlugin extends Plugin {
    settings: FolderCreatorSettings;

    async onload() {
        await this.loadSettings();

        // 添加功能区图标按钮
        this.addRibbonIcon('folder-tree', '批量创建文件夹/文件', () => {
            this.executeCreate();
        });

        // 添加命令
        this.addCommand({
            id: 'batch-create-items',
            name: '批量创建文件夹或文件',
            callback: () => {
                this.executeCreate();
            }
        });

        // 添加设置选项卡
        this.addSettingTab(new FolderCreatorSettingTab(this.app, this));
    }

    // 执行创建逻辑
    async executeCreate() {
        // 检查是否为桌面端
        if (!Platform.isDesktopApp) {
            new Notice('此功能仅在 Obsidian 桌面端可用');
            return;
        }

        const basePath = this.settings.basePath.trim();
        
        // 若未配置路径，提示用户
        if (!basePath) {
            new Notice('请先在插件设置中填写绝对路径');
            return;
        }

        await this.createItems();
    }

    // 核心功能：根据创建类型执行不同逻辑
    async createItems() {
        const createType = this.settings.createType;
        
        if (createType === 'tree') {
            await this.createFromTreeStructure();
        } else if (createType === 'folder') {
            await this.createSimpleFolders();
        } else if (createType === 'file') {
            await this.createSimpleFiles();
        }
    }

    // 原有的简单文件夹创建逻辑
    async createSimpleFolders() {
        const basePath = this.settings.basePath.trim();
        const folderNamesRaw = this.settings.treeStructure; // 复用 treeStructure 字段

        if (!folderNamesRaw) {
            new Notice('请填写文件夹名称列表（用逗号分隔）');
            return;
        }

        let itemNames: string[] = folderNamesRaw.split(',').map(name => name.trim()).filter(name => name !== '');
        
        if (itemNames.length === 0) {
            new Notice('没有有效的名称');
            return;
        }

        const result = await this.createItemsWithValidation(basePath, itemNames, 'folder');
        
        const typeText = '文件夹';
        if (result.failedCount === 0) {
            new Notice(`成功创建 ${result.createdCount} 个${typeText}，跳过已存在的 ${result.skippedCount} 个。`);
        } else {
            new Notice(`创建完成：成功 ${result.createdCount} 个，失败 ${result.failedCount} 个，跳过 ${result.skippedCount} 个。`);
        }
    }

    // 原有的简单文件创建逻辑
    async createSimpleFiles() {
        const basePath = this.settings.basePath.trim();
        const fileNamesRaw = this.settings.treeStructure;

        if (!fileNamesRaw) {
            new Notice('请填写文件名称列表（用逗号分隔）');
            return;
        }

        let itemNames: string[] = fileNamesRaw.split(',').map(name => name.trim()).filter(name => name !== '');
        
        if (itemNames.length === 0) {
            new Notice('没有有效的名称');
            return;
        }

        const result = await this.createItemsWithValidation(basePath, itemNames, 'file');
        
        const typeText = 'md 文件';
        if (result.failedCount === 0) {
            new Notice(`成功创建 ${result.createdCount} 个${typeText}，跳过已存在的 ${result.skippedCount} 个。`);
        } else {
            new Notice(`创建完成：成功 ${result.createdCount} 个，失败 ${result.failedCount} 个，跳过 ${result.skippedCount} 个。`);
        }
    }

    // 通用的创建验证逻辑
    async createItemsWithValidation(basePath: string, itemNames: string[], type: 'folder' | 'file') {
        // 检查基础路径
        if (!fs.existsSync(basePath)) {
            new Notice(`基础路径不存在：${basePath}`);
            return { createdCount: 0, skippedCount: 0, failedCount: 0 };
        }

        const stat = fs.statSync(basePath);
        if (!stat.isDirectory()) {
            new Notice(`基础路径不是一个目录：${basePath}`);
            return { createdCount: 0, skippedCount: 0, failedCount: 0 };
        }

        // 检查非法字符
        const invalidNames: string[] = [];
        for (const name of itemNames) {
            if (INVALID_CHARS_REGEX.test(name)) {
                invalidNames.push(name);
            }
        }

        if (invalidNames.length > 0) {
            new Notice(`以下名称包含非法字符，请修改:\n${invalidNames.join(', ')}`, 0);
            return { createdCount: 0, skippedCount: 0, failedCount: 0 };
        }

        let createdCount = 0;
        let skippedCount = 0;
        let failedCount = 0;

        for (const itemName of itemNames) {
            let fullPath: string;
            
            if (type === 'folder') {
                fullPath = path.join(basePath, itemName);
                try {
                    if (!fs.existsSync(fullPath)) {
                        fs.mkdirSync(fullPath, { recursive: true });
                        createdCount++;
                    } else {
                        skippedCount++;
                    }
                } catch (err) {
                    console.error(`创建文件夹失败：${fullPath}`, err);
                    failedCount++;
                }
            } else {
                const fileName = itemName.endsWith('.md') ? itemName : `${itemName}.md`;
                fullPath = path.join(basePath, fileName);
                try {
                    if (!fs.existsSync(fullPath)) {
                        const defaultContent = `# ${path.basename(fileName, '.md')}\n\n`;
                        fs.writeFileSync(fullPath, defaultContent, 'utf8');
                        createdCount++;
                    } else {
                        skippedCount++;
                    }
                } catch (err) {
                    console.error(`创建文件失败：${fullPath}`, err);
                    failedCount++;
                }
            }
        }

        return { createdCount, skippedCount, failedCount };
    }

    // 从树形结构创建
    async createFromTreeStructure() {
        const basePath = this.settings.basePath.trim();
        const treeText = this.settings.treeStructure;

        if (!treeText) {
            new Notice('请填写树形结构文本');
            return;
        }

        // 检查基础路径
        if (!fs.existsSync(basePath)) {
            new Notice(`基础路径不存在：${basePath}`);
            return;
        }

        const stat = fs.statSync(basePath);
        if (!stat.isDirectory()) {
            new Notice(`基础路径不是一个目录：${basePath}`);
            return;
        }

        // 解析树形结构
        const parseResult = this.parseTreeStructure(treeText);
        
        if (parseResult.errors.length > 0) {
            new Notice(`解析错误:\n${parseResult.errors.slice(0, 5).join('\n')}${parseResult.errors.length > 5 ? '\n...' : ''}`, 0);
            return;
        }

        if (parseResult.root.children.size === 0) {
            new Notice('没有有效的树形结构内容');
            return;
        }

        // 创建所有节点
        const result = await this.createTreeNodes(basePath, parseResult.root);
        
        // 显示详细结果
        let message = `创建完成！\n`;
        message += `✅ 成功: ${result.createdCount} 个\n`;
        message += `⏭️  跳过(已存在): ${result.skippedCount} 个\n`;
        message += `❌ 失败: ${result.failedCount} 个\n`;
        
        if (result.invalidNames.length > 0) {
            message += `\n⚠️  跳过的非法名称: ${result.invalidNames.slice(0, 5).join(', ')}${result.invalidNames.length > 5 ? '...' : ''}`;
        }
        
        new Notice(message, 8000);
        
        // 如果有错误，输出到控制台
        if (result.failedCount > 0) {
            console.error('创建失败的详情:', result.errors);
        }
    }

    // 解析树形结构文本
    parseTreeStructure(text: string): { root: TreeNode; errors: string[] } {
        const lines = text.split('\n');
        const root: TreeNode = {
            name: 'root',
            isFile: false,
            children: new Map()
        };
        const errors: string[] = [];
        
        // 用于跟踪每一层的父节点
        const parentStack: { node: TreeNode; indentLevel: number }[] = [{ node: root, indentLevel: -1 }];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '') continue; // 跳过空行
            
            // 计算缩进级别（空格数，支持2或4空格，也支持tab）
            let indentLevel = 0;
            const match = line.match(/^(\s*)/);
            if (match) {
                const indentStr = match[1];
                // 支持空格和tab，将tab视为4个空格
                indentLevel = indentStr.replace(/\t/g, '    ').length;
            }
            
            // 获取内容（去除首尾空格）
            const content = line.trim();
            if (content === '') continue;
            
            // 检查是否是文件（以.md结尾，或其他常见扩展名）
            const isFile = content.endsWith('.md') || content.includes('.');
            
            // 检查非法字符
            if (INVALID_CHARS_REGEX.test(content)) {
                errors.push(`第 ${i + 1} 行: "${content}" 包含非法字符`);
                continue;
            }
            
            // 找到当前行的父节点
            while (parentStack.length > 1 && parentStack[parentStack.length - 1].indentLevel >= indentLevel) {
                parentStack.pop();
            }
            
            const parent = parentStack[parentStack.length - 1].node;
            
            // 检查是否已存在同名节点
            if (parent.children.has(content)) {
                errors.push(`第 ${i + 1} 行: "${content}" 在父级 "${this.getNodePath(parent)}" 中已存在，将被忽略`);
                continue;
            }
            
            // 创建新节点
            const newNode: TreeNode = {
                name: content,
                isFile: isFile,
                children: new Map()
            };
            
            parent.children.set(content, newNode);
            
            // 只有文件夹才能作为父节点
            if (!isFile) {
                parentStack.push({ node: newNode, indentLevel: indentLevel });
            }
        }
        
        return { root, errors };
    }
    
    // 获取节点路径（用于错误提示）
    getNodePath(node: TreeNode): string {
        // 简化实现，只返回节点名
        return node.name === 'root' ? '根目录' : node.name;
    }
    
    // 递归创建树形节点
    async createTreeNodes(basePath: string, node: TreeNode, currentPath: string = ''): Promise<{
        createdCount: number;
        skippedCount: number;
        failedCount: number;
        invalidNames: string[];
        errors: string[];
    }> {
        let createdCount = 0;
        let skippedCount = 0;
        let failedCount = 0;
        const invalidNames: string[] = [];
        const errors: string[] = [];
        
        for (const [name, child] of node.children) {
            const fullPath = path.join(basePath, currentPath, name);
            
            // 检查非法字符（双重验证）
            if (INVALID_CHARS_REGEX.test(name)) {
                invalidNames.push(name);
                errors.push(`非法字符: ${name}`);
                continue;
            }
            
            try {
                if (child.isFile) {
                    // 确保文件名以 .md 结尾
                    const fileName = name.endsWith('.md') ? name : `${name}.md`;
                    const filePath = path.join(basePath, currentPath, fileName);
                    
                    if (!fs.existsSync(filePath)) {
                        // 确保父目录存在
                        const dirPath = path.dirname(filePath);
                        if (!fs.existsSync(dirPath)) {
                            fs.mkdirSync(dirPath, { recursive: true });
                        }
                        
                        const defaultContent = `# ${path.basename(fileName, '.md')}\n\n`;
                        fs.writeFileSync(filePath, defaultContent, 'utf8');
                        createdCount++;
                    } else {
                        skippedCount++;
                    }
                } else {
                    // 创建文件夹
                    if (!fs.existsSync(fullPath)) {
                        fs.mkdirSync(fullPath, { recursive: true });
                        createdCount++;
                    } else {
                        skippedCount++;
                    }
                    
                    // 递归处理子节点
                    const subResult = await this.createTreeNodes(basePath, child, path.join(currentPath, name));
                    createdCount += subResult.createdCount;
                    skippedCount += subResult.skippedCount;
                    failedCount += subResult.failedCount;
                    invalidNames.push(...subResult.invalidNames);
                    errors.push(...subResult.errors);
                }
            } catch (err) {
                console.error(`创建失败: ${fullPath}`, err);
                failedCount++;
                errors.push(`${fullPath}: ${err.message}`);
            }
        }
        
        return { createdCount, skippedCount, failedCount, invalidNames, errors };
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

// 设置选项卡类
class FolderCreatorSettingTab extends PluginSettingTab {
    plugin: FolderCreatorPlugin;

    constructor(app: App, plugin: FolderCreatorPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: '批量创建文件夹/文件设置' });

        new Setting(containerEl)
            .setName('绝对路径')
            .setDesc('要创建文件夹或文件的目标绝对路径（例如：D:/MyFolders 或 /home/user/Documents）')
            .addText(text => text
                .setPlaceholder('请输入绝对路径...')
                .setValue(this.plugin.settings.basePath)
                .onChange(async (value) => {
                    this.plugin.settings.basePath = value;
                    await this.plugin.saveSettings();
                }));

        // 添加创建类型下拉选项
        new Setting(containerEl)
            .setName('创建类型')
            .setDesc('选择要创建的内容类型')
            .addDropdown(dropdown => dropdown
                .addOption('tree', '📁 树形结构（支持多级嵌套）')
                .addOption('folder', '📂 简单文件夹（逗号分隔）')
                .addOption('file', '📄 简单文件（逗号分隔）')
                .setValue(this.plugin.settings.createType)
                .onChange(async (value: 'folder' | 'file' | 'tree') => {
                    this.plugin.settings.createType = value;
                    await this.plugin.saveSettings();
                    // 刷新显示以更新描述文本
                    this.display();
                }));

        // 根据创建类型显示不同的描述和输入框
        const createType = this.plugin.settings.createType;
        
        if (createType === 'tree') {
            new Setting(containerEl)
                .setName('目录树结构')
                .setDesc('使用缩进表示层级关系（支持2或4空格，也支持Tab缩进）\n示例：\n项目A\n  文档\n    readme.md\n    需求.md\n  代码\n项目B\n  备份\n  笔记.md')
                .addTextArea(text => {
                    text.setPlaceholder(`项目A
  文档
    readme.md
    需求.md
  代码
项目B
  备份
  笔记.md`)
                        .setValue(this.plugin.settings.treeStructure)
                        .onChange(async (value) => {
                            this.plugin.settings.treeStructure = value;
                            await this.plugin.saveSettings();
                        });
                    
                    // 设置文本框样式
                    text.inputEl.style.width = '300px';
                    text.inputEl.style.height = '300px';
                    text.inputEl.style.resize = 'vertical';
                    text.inputEl.style.fontFamily = 'monospace';
                    text.inputEl.style.fontSize = '13px';
                });
        } else if (createType === 'folder') {
            new Setting(containerEl)
                .setName('文件夹名称列表')
                .setDesc('用英文逗号分隔的文件夹名称（仅创建一级文件夹）')
                .addTextArea(text => {
                    text.setPlaceholder('项目A, 项目B, 资料_2024, 笔记')
                        .setValue(this.plugin.settings.treeStructure)
                        .onChange(async (value) => {
                            this.plugin.settings.treeStructure = value;
                            await this.plugin.saveSettings();
                        });
                    
                    text.inputEl.style.width = '300px';
                    text.inputEl.style.height = '120px';
                    text.inputEl.style.resize = 'vertical';
                });
        } else {
            new Setting(containerEl)
                .setName('文件名称列表')
                .setDesc('用英文逗号分隔的文件名称（仅创建一级md文件，会自动添加.md后缀）')
                .addTextArea(text => {
                    text.setPlaceholder('README, 笔记, 待办事项, 日记')
                        .setValue(this.plugin.settings.treeStructure)
                        .onChange(async (value) => {
                            this.plugin.settings.treeStructure = value;
                            await this.plugin.saveSettings();
                        });
                    
                    text.inputEl.style.width = '300px';
                    text.inputEl.style.height = '120px';
                    text.inputEl.style.resize = 'vertical';
                });
        }

        new Setting(containerEl)
            .setName('操作')
            .setDesc('点击后根据上述设置批量创建')
            .addButton(button => button
                .setButtonText('立即创建')
                .setCta()
                .onClick(async () => {
                    await this.plugin.createItems();
                }));
    }
}