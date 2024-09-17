// 计算内存地址
function calculateAddress(base, offsets) {
    try {
        let addr = base;
        for (let i = 0; i < offsets.length; i++) {
            addr = addr.add(offsets[i]);
            if (i < offsets.length - 1) {
                addr = Memory.readPointer(addr); // Frida 读取指针
                if (addr.isNull()) {
                    console.warn("计算地址时出错，所以操作都需要进入地图中才有效");
                    return null;
                }
            }
        }
        return addr;
    } catch (err) {
        console.error(`内存地址计算错误: ${err.message}`);
        return null;
    }
}

// 尝试多个 offset 数组，直到找到一个有效地址
function tryOffsets(base, offsetsArray) {
    for (let i = 0; i < offsetsArray.length; i++) {
        let address = calculateAddress(base, offsetsArray[i]);
        if (address !== null && validateAddress(address)) {
            return address; // 返回计算出的有效地址
        }
    }
    console.warn("所有偏移尝试均无效");
    return null;
}

// 验证地址是否有效
function validateAddress(address) {
    try {
        let testValue = Memory.readPointer(ptr(address));
        return true; // 地址有效
    } catch (err) {
        console.error(`无效的内存地址: ${address}, ��误: ${err.message}`);
        return false; // 地址无效
    }
}

// 定义动态基址功能类 + 冻结功能
class Feature {
    constructor(name, offsets, interval, enabledValue, disabledValue, persistAddress = false) {
        this.name = name;
        this.offsets = offsets; // offsets 是一个数组的数组
        this.interval = interval;
        this.threads = {}; // 用于存储所有功能的定时器
        this.address = null;
        this.enabledValue = enabledValue;
        this.disabledValue = disabledValue;
        this.persistAddress = persistAddress; // 是否持久化地址
        this.addressCalculated = false; // 用于标记地址是否已计算
        this.matchedAddressPairs = []; // 保存匹配到的地址对
    }

    start() {
        if (this.threads[this.name]) {
            console.log(`${this.name}功能已在运行`);
            return;
        }

        // 如果地址没有计算过或不持久化，则重新计算地址
        if (!this.addressCalculated || !this.persistAddress) {
            this.address = tryOffsets(base, this.offsets);
            if (this.address === null) {
                return;
            }
        }

        // 验证计算出的地址是否有效
        if (!validateAddress(this.address)) {
            console.warn(`${this.name}地址无效，功��无法启动！`);
            return;
        }

        this.addressCalculated = true;

        // 启动功能，按指定的时间间隔写入值
        this.threads[this.name] = setInterval(() => {
            try {
                Memory.writeS32(ptr(this.address), this.enabledValue);
            } catch (err) {
                console.error(`写入内存时出错: ${err.message}`);
                this.stop(); // 如果出错，停止功能
            }
        }, this.interval);
        console.log(`${this.name}功能已启动`);
    }

    stop() {
        if (this.threads[this.name]) {
            clearInterval(this.threads[this.name]);
            try {
                Memory.writeS32(ptr(this.address), this.disabledValue);
            } catch (err) {
                console.error(`写入内存时出错: ${err.message}`);
            }
            delete this.threads[this.name];
            console.log(`${this.name}功能已关闭`);
        }
    }

    // 管理地址对的功能（查找和修改）
    manageAddressPairs(action = 'find', maxTries = 50) {
        if (action === 'find') {
            if (this.isSearching) {
                console.log("已经在查找中");
                return;
            }
            console.log('开始查找其他玩家实体');

            this.isSearching = true;
            let baseAddress = calculateAddress(base, this.offsets[0]);

            if (baseAddress === null) {
                this.isSearching = false;
                return;
            }

            let collisionBoxAddress = baseAddress.add(0x38);
            let offset = 0x0;
            let tries = 0;

            let intervalId = setInterval(() => {
                if (tries >= maxTries) {
                    console.log(`查找完成，共找到 ${this.matchedAddressPairs.length} 组数据`);
                    clearInterval(intervalId);
                    this.isSearching = false;
                    return;
                }

                let currentAddress = collisionBoxAddress.add(offset);
                let currentSize, adjacentSize;

                try {
                    currentSize = Memory.readFloat(ptr(currentAddress));
                    adjacentSize = Memory.readFloat(ptr(currentAddress).add(0x4));
                } catch (err) {
                    console.error("读取内存时出错");
                    clearInterval(intervalId);
                    this.isSearching = false;
                    return;
                }

                if (Math.abs(currentSize - 0.6) < 1e-6 && Math.abs(adjacentSize - 1.8) < 1e-6) {
                    let isDuplicate = this.matchedAddressPairs.some(pair => pair[0].equals(currentAddress));
                    if (!isDuplicate && validateAddress(currentAddress) && validateAddress(currentAddress.add(0x4))) {
                        this.matchedAddressPairs.push([currentAddress, currentAddress.add(0x4)]);
                    }
                }

                offset += 0x20;
                tries++;
            }, 100);
        } else if (action === 'modify') {
            if (this.matchedAddressPairs.length === 0) {
                console.log('其他玩家数为0，不必开启');
                return;
            }

            this.threads[`${this.name}_modify`] = setInterval(() => {
                this.matchedAddressPairs.forEach(pair => {
                    try {
                        Memory.writeFloat(ptr(pair[0]), this.enabledValue);
                        Memory.writeFloat(ptr(pair[1]), this.enabledValue);
                    } catch (err) {
                        console.error(`修改失败: ${err.message}`);
                    }
                });
            }, this.interval);
        } else if (action === 'stop') {
            if (this.threads[`${this.name}_modify`]) {
                clearInterval(this.threads[`${this.name}_modify`]);
                delete this.threads[`${this.name}_modify`];
                console.log(`${this.name}功能已关闭`);
            }
        }
    }
}

// 主函数，定义功能并启动
function main() {
    let fly = new Feature('飞行', [
        [0xDFB8A38, 0x88, 0x88, 0xA50, 0x48, 0x0, 0x1AC],
    ], 50, 1, 0, true);

    let throughWalls = new Feature('穿墙', [
        [0xDFB8A38, 0x88, 0x88, 0xA50, 0x48, 0x0, 0x20C]
    ], 1000, 1, 0, true);
    
    let collisionBox = new Feature('碰撞箱', [
        [0xDFB8A38, 0xD8, 0x208, 0x0, 0x2F8, 0x0]
    ], 100, 5, 0.6);
    
    let creativeMode = new Feature('伪创造', [
        [0xDFB8A38, 0x628, 0x38, 0xA90, 0xB8, 0x200]
    ], 1000, 1, 5, true);

    let menu = modmenu.create('冈易4399', menu_list, {
        onchange: function (result) {
            switch (result.id) {
                case 'fly':
                    result.val ? fly.start() : fly.stop();
                    break;
                case 'throughWalls':
                    result.val ? throughWalls.start() : throughWalls.stop();
                    break;
                case 'CollisionBox_size':
                    collisionBox.enabledValue = result.val;
                    break;
                case 'findentity':
                    collisionBox.manageAddressPairs('find');
                    break;
                case 'CollisionBox':
                    result.val ? collisionBox.manageAddressPairs('modify') : collisionBox.manageAddressPairs('stop');
                    break;
                case 'creativeMode':
                    result.val ? creativeMode.start() : creativeMode.stop();
                    break;
            }
        }
    });
    menu.state();
}

// 菜单定义
let menu_list = [
    { 'id': 'fly', 'type': 'checkbox', 'title': '飞行', 'val': false },
    { 'id': 'throughWalls', 'type': 'checkbox', 'title': '穿墙', 'val': false },
    { 'id': 'CollisionBox_size', 'type': 'slider', 'title': '碰撞箱大小', 'val': 0, 'min': 0, 'max': 20 },
    { 'id': 'findentity', 'type': 'button', 'title': '查找其他玩家实体' },
    { 'id': 'CollisionBox', 'type': 'checkbox', 'title': '碰撞箱', 'val': false },
    { 'id': 'creativeMode', 'type': 'checkbox', 'title': '伪创造(概率无效)', 'val': false }
];

// 获取基址并启动主函数
let base;
if ((base = Module.findBaseAddress("libminecraftpe.so")) === null) {
    toast("获取模块基址失败，脚本终止!");
    modmenu.closeAll()
} else {
    main();
}
