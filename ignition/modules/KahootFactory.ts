import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("KahootFactoryModule", (m) => {
    const factory = m.contract("KahootFactory");

    return { factory };
});