// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./KahootGame.sol";

contract KahootFactory {
    KahootGame[] public games;

    event GameCreated(address indexed gameAddress, address indexed professor);

    function createGame(
        uint256 _passingScore,
        uint256 _totalQuestions,
        string calldata _metadataURI,
        string calldata _diplomaTokenURI,
        uint8[] calldata _correctAnswers
    ) external returns (address) {
        
        KahootGame newGame = new KahootGame(
            msg.sender,
            _passingScore,
            _totalQuestions,
            _metadataURI,
            _diplomaTokenURI,
            _correctAnswers
        );
        
        games.push(newGame);
        emit GameCreated(address(newGame), msg.sender);
        
        return address(newGame);
    }

    function getGamesCount() external view returns (uint256) {
        return games.length;
    }
}
