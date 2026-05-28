import { expect } from "chai";
import { network } from "hardhat";
import { describe, it, beforeEach } from "node:test";
import { keccak256, encodePacked, parseEther } from "viem";

describe("KahootGame - Diploma NFT y Reclamos", function () {
  let factory, game, diplomaNFT;
  let owner, profesor, alumnoHonesto, alumnoTramposo, alumnoExtra;
  let viem;

  const metadataURI = "ipfs://QmMockMetadata...";
  const diplomaURI = "ipfs://QmMockDiploma...";
  const profeSalt = "secretoProfe";
  const entryFee = parseEther("0.01");
  const creationFee = parseEther("0.001");

  function generateHash(opcion, salt, address) {
    return keccak256(
      encodePacked(
        ["uint8", "string", "address"],
        [opcion, salt, address]
      )
    );
  }

  async function expectRevert(promise, expectedReason) {
    try {
      await promise;
      expect.fail("La transaccion deberia haber fallado");
    } catch (error) {
      expect(error.message).to.include(expectedReason);
    }
  }

  beforeEach(async function () {
    const networkContext = await network.create({
      network: "hardhatMainnet",
      chainType: "l1",
    });
    viem = networkContext.viem;

    const walletClients = await viem.getWalletClients();
    [owner, profesor, alumnoHonesto, alumnoTramposo, alumnoExtra] = walletClients;

    factory = await viem.deployContract("KahootFactory", [creationFee]);
    const hashRespuesta1 = generateHash(1, profeSalt, profesor.account.address);
    await factory.write.createGame(
      [1n, 1n, metadataURI, diplomaURI, [hashRespuesta1], entryFee],
      { account: profesor.account, value: creationFee }
    );
    const gameAddress = await factory.read.games([0n]);
    game = await viem.getContractAt("KahootGame", gameAddress);
    
    const diplomaAddress = await game.read.diplomaContract();
    diplomaNFT = await viem.getContractAt("DiplomaNFT", diplomaAddress);
  });

  it("Proteccion de Doble Claim", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });

    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)], { account: alumnoHonesto.account });
    
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account }); 
    
    await game.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });
    await game.write.advanceToNextQuestion({ account: profesor.account });

    await game.write.claimDiploma({ account: alumnoHonesto.account });

    await expectRevert(
      game.write.claimDiploma({ account: alumnoHonesto.account }),
      "Ya reclamaste tu diploma"
    );
  });

  it("Alumno desaprobado no puede reclamar diploma", async function () {
    const p1 = generateHash(1, profeSalt, profesor.account.address);
    const p2 = generateHash(2, profeSalt, profesor.account.address);

    await factory.write.createGame(
      [2n, 2n, metadataURI, diplomaURI, [p1, p2], entryFee], 
      { account: profesor.account, value: creationFee }
    );
    const gameAddr = await factory.read.games([1n]);
    const gameDesa = await viem.getContractAt("KahootGame", gameAddr);

    await gameDesa.write.joinGame({ value: entryFee, account: alumnoHonesto.account });

    // Q1
    await gameDesa.write.startNextQuestion({ account: profesor.account });
    await gameDesa.write.commitAnswer([generateHash(3, "wrong1", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await gameDesa.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });
    await gameDesa.write.revealAnswer([0n, 3, "wrong1"], { account: alumnoHonesto.account });
    await gameDesa.write.advanceToNextQuestion({ account: profesor.account });

    // Q2
    await gameDesa.write.startNextQuestion({ account: profesor.account });
    await gameDesa.write.commitAnswer([generateHash(2, "right2", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await gameDesa.write.closeQuestionAndStartReveal([2, profeSalt], { account: profesor.account });
    await gameDesa.write.revealAnswer([1n, 2, "right2"], { account: alumnoHonesto.account });
    await gameDesa.write.advanceToNextQuestion({ account: profesor.account });

    expect(await gameDesa.read.isFinished()).to.be.true;
    expect(await gameDesa.read.scores([alumnoHonesto.account.address])).to.equal(1n);

    await expectRevert(
      gameDesa.write.claimDiploma({ account: alumnoHonesto.account }),
      "No alcanzas el puntaje"
    );
  });

  it("claimDiploma falla si el juego no terminó", async function () {
    await expectRevert(
      game.write.claimDiploma({ account: alumnoHonesto.account }),
      "El juego no ha terminado"
    );
  });

  it("Alumno que nunca jugó no puede reclamar diploma", async function () {
    await game.write.joinGame({ value: entryFee, account: alumnoHonesto.account });
    await game.write.startNextQuestion({ account: profesor.account });
    await game.write.commitAnswer([generateHash(1, "s1", alumnoHonesto.account.address)],{ account: alumnoHonesto.account });
    await game.write.closeQuestionAndStartReveal([1, profeSalt], { account: profesor.account });
    await game.write.revealAnswer([0n, 1, "s1"], { account: alumnoHonesto.account });
    await game.write.advanceToNextQuestion({ account: profesor.account });

    expect(await game.read.isFinished()).to.be.true;

    await expectRevert(
      game.write.claimDiploma({ account: alumnoTramposo.account }),
      "No alcanzas el puntaje minimo"
    );
  });

  it("DiplomaNFT - solo el contrato KahootGame puede mintear", async function () {
    await expectRevert(
      diplomaNFT.write.mintDiploma(
        [alumnoHonesto.account.address, diplomaURI],
        { account: profesor.account }
      ),
      "UnauthorizedGame"
    );
  });

  it("DiplomaNFT - falla con InvalidAddress si game es address(0)", async function () {
    const zeroAddress = "0x0000000000000000000000000000000000000000";
    await expectRevert(
      viem.deployContract("DiplomaNFT", [zeroAddress]),
      "InvalidAddress"
    );
  });

});
