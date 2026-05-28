// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./KahootGame.sol";

contract KahootFactory {
    KahootGame[] public games;

    // ─── Leaderboard Global (Top 10) ──────────────────────────────────────────
    mapping(address => uint256) public totalDiplomasWon;
    address[10] public topJugadores;
    uint256[10] public topBalances;
    mapping(address => bool) public isOfficialGame;

    event GameCreated(address indexed gameAddress, address indexed professor);
    event LeaderboardUpdated(address indexed student, uint256 newTotal);

    function createGame(
        uint256 _passingScore,
        uint256 _totalQuestions,
        string calldata _metadataURI,
        string calldata _diplomaTokenURI,
        bytes32[] calldata _correctAnswerCommits,
        uint256 _entryFee
    ) external returns (address) {
        KahootGame newGame = new KahootGame(
            address(this),
            msg.sender,
            _passingScore,
            _totalQuestions,
            _metadataURI,
            _diplomaTokenURI,
            _correctAnswerCommits,
            _entryFee
        );
        games.push(newGame);
        isOfficialGame[address(newGame)] = true;
        emit GameCreated(address(newGame), msg.sender);

        return address(newGame);
    }

    /**
     * @notice Registra un diploma ganado por un estudiante y actualiza el Top 10.
     * @dev Solo puede ser llamada por un contrato KahootGame válido creado por este Factory.
     */
    function recordDiplomaWin(address student) external {
        require(isOfficialGame[msg.sender], "Hackeo detectado: Solo juegos oficiales pueden dar puntos");

        uint256 newTotal = totalDiplomasWon[student] + 1;
        totalDiplomasWon[student] = newTotal;

        // Buscar si el student ya está en el top 10
        int256 existingIndex = -1;
        for (uint256 i = 0; i < 10; i++) {
            if (topJugadores[i] == student) {
                existingIndex = int256(i);
                break;
            }
        }

        if (existingIndex >= 0) {
            // Caso A: ya está en el top 10 → actualizar balance y burbujear hacia arriba
            uint256 idx = uint256(existingIndex);
            topBalances[idx] = newTotal;
            while (idx > 0 && topBalances[idx] > topBalances[idx - 1]) {
                address tmpAddr = topJugadores[idx - 1];
                uint256 tmpBal = topBalances[idx - 1];
                topJugadores[idx - 1] = topJugadores[idx];
                topBalances[idx - 1] = topBalances[idx];
                topJugadores[idx] = tmpAddr;
                topBalances[idx] = tmpBal;
                idx--;
            }
        } else if (newTotal > topBalances[9]) {
            // Caso B: no está en el top 10 pero supera al último puesto → insertar
            topJugadores[9] = student;
            topBalances[9] = newTotal;
            uint256 idx = 9;
            while (idx > 0 && topBalances[idx] > topBalances[idx - 1]) {
                address tmpAddr = topJugadores[idx - 1];
                uint256 tmpBal = topBalances[idx - 1];
                topJugadores[idx - 1] = topJugadores[idx];
                topBalances[idx - 1] = topBalances[idx];
                topJugadores[idx] = tmpAddr;
                topBalances[idx] = tmpBal;
                idx--;
            }
        }

        emit LeaderboardUpdated(student, newTotal);
    }

    function getGamesCount() external view returns (uint256) {
        return games.length;
    }
}
